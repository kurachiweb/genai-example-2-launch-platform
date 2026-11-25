import { getColumns, getTableName } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { sqlStringLiteral } from '../../admin/sql-string-literal.ts';
import type { ScaleProfile } from './scale-profile.ts';

export type SqlValue = string | number | boolean | Date | null;

export type SqlRow = Readonly<Record<string, SqlValue | undefined>>;

export interface SqlStatement {
  readonly text: string;
  readonly table: string;
  readonly insertedRows: number;
}

export interface DatasetContext {
  readonly seed: number;
  readonly baseDate: string;
  readonly exportUserId?: string;
  readonly logoFileId?: string;
}

export type DatasetSamples = Readonly<Record<string, readonly string[]>>;

export interface SyntheticDataset {
  readonly name: string;
  readonly dependsOn: readonly string[];
  generate(
    profile: ScaleProfile,
    context: DatasetContext,
  ): Iterable<SqlStatement>;
  samples?(profile: ScaleProfile, context: DatasetContext): DatasetSamples;
}

export interface WriteSqlFilesOptions {
  readonly outDir: string;
  readonly seed: number;
  readonly baseDate: string;
  readonly maxStatementsPerFile: number;
  readonly exportUserId?: string;
  readonly logoFileId?: string;
}

export interface SyntheticManifestFile {
  readonly order: number;
  readonly name: string;
  readonly dataset: string;
  readonly statements: number;
  readonly bytes: number;
}

export interface SyntheticManifest {
  readonly profile: string;
  readonly seed: number;
  readonly baseDate: string;
  readonly exportUserId?: string;
  readonly logoFileId?: string;
  readonly maxStatementsPerFile: number;
  readonly maxStatementBytes: number;
  readonly files: readonly SyntheticManifestFile[];
  readonly counts: Readonly<Record<string, number>>;
  readonly samples: DatasetSamples;
}

// D1の1文の長さの上限(100KB)に余裕を持たせた値
export const MAX_STATEMENT_BYTES = 90_000;

const MANIFEST_FILE_NAME = 'manifest.json';

const OUTPUT_FILE_PATTERN = /^\d{4}-.+\.sql$/u;

const FILE_NUMBER_WIDTH = 4;

// 制御文字を置き換える式(replaceの入れ子と文字の呼び出し)が文に足す長さの上限。長い値を分ける時に断片の予算から引く
const REPLACEMENT_RESERVE_BYTES = 150;

// 置き換え用の文字(私用領域)1文字のUTF-8の長さ
const PLACEHOLDER_COST_BYTES = 3;

const PLACEHOLDER_START = 0xe000;

const CHARACTER_CALLS: Readonly<Record<string, string>> = Object.freeze({
  '\n': 'char(10)',
  '\r': 'char(13)',
  '\t': 'char(9)',
});

type ColumnKind = 'text' | 'integer';

interface ColumnPlan {
  readonly key: string;
  readonly name: string;
  readonly kind: ColumnKind;
  readonly required: boolean;
  readonly defaultValue: unknown;
  readonly enumValues: readonly string[] | undefined;
  readonly primary: boolean;
}

interface TablePlan {
  readonly name: string;
  readonly columns: readonly ColumnPlan[];
  readonly header: string;
}

const byteLengthOf = (text: string): number => Buffer.byteLength(text, 'utf8');

// 改行とタブは文字列のリテラルへ直接書けず、sqlStringLiteralが拒否するため、値に無い私用領域の文字で書いてからreplaceでchar関数の値へ戻す。式の深さが改行の数に比例しないため、SQLiteの式の深さの上限(1000)に掛からない。SQLの文を1行に保つ効果もある
export function textLiteral(value: string): string {
  const present = Object.entries(CHARACTER_CALLS).filter(([character]) =>
    value.includes(character),
  );
  if (present.length === 0) {
    return sqlStringLiteral(value);
  }
  let code = PLACEHOLDER_START;
  let text = value;
  const replacements: { placeholder: string; call: string }[] = [];
  for (const [character, call] of present) {
    while (value.includes(String.fromCodePoint(code))) {
      code += 1;
    }
    const placeholder = String.fromCodePoint(code);
    code += 1;
    text = text.replaceAll(character, placeholder);
    replacements.push({ placeholder, call });
  }
  return replacements.reduce(
    (expression, { placeholder, call }) =>
      `replace(${expression}, ${sqlStringLiteral(placeholder)}, ${call})`,
    sqlStringLiteral(text),
  );
}

function kindOf(sqlType: string, key: string): ColumnKind {
  if (sqlType.startsWith('text')) {
    return 'text';
  }
  if (sqlType.startsWith('integer')) {
    return 'integer';
  }
  throw new TypeError(`列${key}の型${sqlType}は書き出せません`);
}

function buildPlan(table: SQLiteTable): TablePlan {
  const name = getTableName(table);
  const columns = Object.entries(getColumns(table)).map(
    ([key, column]): ColumnPlan => ({
      key,
      name: column.name,
      kind: kindOf(column.getSQLType(), key),
      required: column.notNull && column.default === undefined,
      defaultValue: column.default as unknown,
      enumValues: column.enumValues as readonly string[] | undefined,
      primary: column.primary,
    }),
  );
  return {
    name,
    columns,
    header: `INSERT INTO ${name} (${columns.map((column) => column.name).join(', ')}) VALUES `,
  };
}

const PLAN_CACHE = new WeakMap<SQLiteTable, TablePlan>();

// 1行ごとに呼ばれても列の解析を繰り返さないよう、テーブル定義ごとに保持する
function planOf(table: SQLiteTable): TablePlan {
  const cached = PLAN_CACHE.get(table);
  if (cached !== undefined) {
    return cached;
  }
  const plan = buildPlan(table);
  PLAN_CACHE.set(table, plan);
  return plan;
}

function integerLiteral(column: ColumnPlan, value: unknown): string {
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  const number = value instanceof Date ? value.getTime() : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number)) {
    throw new TypeError(
      `列${column.key}は整数・真偽・有効な日時で指定してください: ${String(value)}`,
    );
  }
  return String(number);
}

function textColumnLiteral(column: ColumnPlan, value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError(
      `列${column.key}は文字列で指定してください: ${String(value)}`,
    );
  }
  if (column.enumValues !== undefined && !column.enumValues.includes(value)) {
    throw new RangeError(
      `列${column.key}は${column.enumValues.join('・')}のいずれかで指定してください: ${value}`,
    );
  }
  return textLiteral(value);
}

function valueLiteral(column: ColumnPlan, value: unknown): string {
  return column.kind === 'text'
    ? textColumnLiteral(column, value)
    : integerLiteral(column, value);
}

function absentLiteral(column: ColumnPlan): string {
  if (column.required) {
    throw new TypeError(`列${column.key}は必須です`);
  }
  if (column.defaultValue === undefined) {
    return 'NULL';
  }
  return valueLiteral(column, column.defaultValue);
}

function assertKnownKeys(plan: TablePlan, row: SqlRow): void {
  const keys = new Set(plan.columns.map((column) => column.key));
  for (const key of Object.keys(row)) {
    if (!keys.has(key)) {
      throw new TypeError(`テーブル${plan.name}に列${key}はありません`);
    }
  }
}

function literalsOf(plan: TablePlan, row: SqlRow): string[] {
  assertKnownKeys(plan, row);
  return plan.columns.map((column) => {
    const value = row[column.key];
    return value === undefined || value === null
      ? absentLiteral(column)
      : valueLiteral(column, value);
  });
}

const insertTextOf = (plan: TablePlan, literals: readonly string[]): string =>
  `${plan.header}(${literals.join(', ')});`;

function assertWithinLimit(text: string, maxStatementBytes: number): void {
  const bytes = byteLengthOf(text);
  if (bytes > maxStatementBytes) {
    throw new RangeError(
      `文の長さが上限(${String(maxStatementBytes)}バイト)を超えています(${String(bytes)}バイト): ${text.slice(0, 80)}`,
    );
  }
}

const costOf = (character: string): number => {
  if (character === "'") {
    return 2;
  }
  return CHARACTER_CALLS[character] === undefined
    ? byteLengthOf(character)
    : PLACEHOLDER_COST_BYTES;
};

// コードポイントの途中では分けず、先頭の断片と以降の断片に別の長さの予算を使う。先頭が入らないときは先頭の断片を空にする
function splitText(
  value: string,
  firstBudget: number,
  restBudget: number,
): string[] {
  const chunks: string[] = [];
  let chunk = '';
  let cost = 0;
  let budget = firstBudget;
  for (const character of value) {
    const characterCost = costOf(character);
    if (cost + characterCost > budget) {
      if (characterCost > restBudget) {
        throw new RangeError('1文字が文の長さの上限に収まりません');
      }
      chunks.push(chunk);
      chunk = '';
      cost = 0;
      budget = restBudget;
    }
    chunk += character;
    cost += characterCost;
  }
  chunks.push(chunk);
  return chunks;
}

interface DeferredColumn {
  readonly column: ColumnPlan;
  readonly value: string;
}

interface PrimaryKey {
  readonly column: ColumnPlan;
  readonly value: string;
}

interface DeferredPlan {
  readonly emptied: readonly string[];
  readonly deferred: readonly DeferredColumn[];
}

function primaryKeyOf(plan: TablePlan, row: SqlRow): PrimaryKey {
  const primary = plan.columns.filter((column) => column.primary);
  const [column] = primary;
  const value = column === undefined ? undefined : row[column.key];
  if (
    primary.length !== 1 ||
    column === undefined ||
    typeof value !== 'string'
  ) {
    throw new TypeError(
      `テーブル${plan.name}の長い値を分けるには、文字列の単一の主キーが必要です`,
    );
  }
  return { column, value };
}

// 長いリテラルの列から順に空にして、行のINSERTが上限に収まるまで続ける。空にした列は後でUPDATEで組み立てる
function deferLongColumns(
  plan: TablePlan,
  row: SqlRow,
  literals: readonly string[],
  maxStatementBytes: number,
): DeferredPlan {
  const byLength = plan.columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => column.kind === 'text')
    .toSorted(
      (left, right) =>
        byteLengthOf(literals[right.index] ?? '') -
        byteLengthOf(literals[left.index] ?? ''),
    );
  const emptied = [...literals];
  const deferred: DeferredColumn[] = [];
  for (const { column, index } of byLength) {
    if (byteLengthOf(insertTextOf(plan, emptied)) <= maxStatementBytes) {
      break;
    }
    emptied[index] = "''";
    deferred.push({ column, value: String(row[column.key]) });
  }
  assertWithinLimit(insertTextOf(plan, emptied), maxStatementBytes);
  return { emptied, deferred };
}

function updateTextOf(
  plan: TablePlan,
  key: PrimaryKey,
  column: ColumnPlan,
  literal: string,
): string {
  return `UPDATE ${plan.name} SET ${column.name} = ${column.name} || ${literal} WHERE ${key.column.name} = ${textLiteral(key.value)};`;
}

function* longRowStatements(
  plan: TablePlan,
  row: SqlRow,
  literals: readonly string[],
  maxStatementBytes: number,
): Generator<SqlStatement> {
  const key = primaryKeyOf(plan, row);
  const { emptied, deferred } = deferLongColumns(
    plan,
    row,
    literals,
    maxStatementBytes,
  );
  const updateBudgetOf = (column: ColumnPlan): number =>
    maxStatementBytes -
    byteLengthOf(updateTextOf(plan, key, column, "''")) -
    REPLACEMENT_RESERVE_BYTES;
  const insertBudget =
    maxStatementBytes -
    byteLengthOf(insertTextOf(plan, emptied)) -
    REPLACEMENT_RESERVE_BYTES;

  // 最初の列だけ、INSERTに残った長さの分を最初の断片として入れる。他の列は空で入れてUPDATEで組み立てる
  const chunksOf = deferred.map(({ column, value }, position) =>
    splitText(
      value,
      position === 0 ? insertBudget : updateBudgetOf(column),
      updateBudgetOf(column),
    ),
  );
  const withFirst = [...emptied];
  const [first] = deferred;
  if (first !== undefined) {
    withFirst[plan.columns.indexOf(first.column)] = textLiteral(
      chunksOf[0]?.[0] ?? '',
    );
  }
  yield {
    text: insertTextOf(plan, withFirst),
    table: plan.name,
    insertedRows: 1,
  };
  for (const [position, { column }] of deferred.entries()) {
    const chunks = (chunksOf[position] ?? []).slice(position === 0 ? 1 : 0);
    for (const chunk of chunks.filter((candidate) => candidate !== '')) {
      yield {
        text: updateTextOf(plan, key, column, textLiteral(chunk)),
        table: plan.name,
        insertedRows: 0,
      };
    }
  }
}

export interface InsertOptions {
  readonly maxStatementBytes?: number;
}

// テーブル定義の列から、行ごとに1文のリテラルのINSERT文を作る。上限を超える長い文字列の列は、最初の断片でINSERTした後に連結のUPDATEを繰り返して組み立てる
export function* insertStatements(
  table: SQLiteTable,
  rows: Iterable<SqlRow>,
  { maxStatementBytes = MAX_STATEMENT_BYTES }: InsertOptions = {},
): Generator<SqlStatement> {
  const plan = planOf(table);
  for (const row of rows) {
    const literals = literalsOf(plan, row);
    const text = insertTextOf(plan, literals);
    if (byteLengthOf(text) <= maxStatementBytes) {
      yield { text, table: plan.name, insertedRows: 1 };
      continue;
    }
    yield* longRowStatements(plan, row, literals, maxStatementBytes);
  }
}

function assertDatasetOrder(datasets: readonly SyntheticDataset[]): void {
  const seen = new Set<string>();
  for (const dataset of datasets) {
    if (seen.has(dataset.name)) {
      throw new Error(`データセット名が重複しています: ${dataset.name}`);
    }
    for (const dependency of dataset.dependsOn) {
      if (!seen.has(dependency)) {
        throw new Error(
          `データセット${dataset.name}が依存する${dependency}が、前に並んでいません`,
        );
      }
    }
    seen.add(dataset.name);
  }
}

function mergedSamples(
  datasets: readonly SyntheticDataset[],
  profile: ScaleProfile,
  context: DatasetContext,
): DatasetSamples {
  const merged: Record<string, readonly string[]> = {};
  for (const dataset of datasets) {
    for (const [key, values] of Object.entries(
      dataset.samples?.(profile, context) ?? {},
    )) {
      if (Object.hasOwn(merged, key)) {
        throw new Error(`見本の名前${key}が重複しています: ${dataset.name}`);
      }
      merged[key] = values;
    }
  }
  return merged;
}

function assertLine(text: string, maxStatementBytes: number): void {
  if (/[\n\r]/u.test(text)) {
    throw new Error(`文に改行が含まれています: ${text.slice(0, 80)}`);
  }
  if (!text.endsWith(';')) {
    throw new Error(`文が;で終わっていません: ${text.slice(0, 80)}`);
  }
  assertWithinLimit(text, maxStatementBytes);
}

async function removePreviousOutput(outDir: string): Promise<void> {
  const names = await readdir(outDir);
  await Promise.all(
    names
      .filter((name) => OUTPUT_FILE_PATTERN.test(name))
      .map((name) => rm(join(outDir, name))),
  );
}

const fileNameOf = (number: number, dataset: string): string =>
  `${String(number).padStart(FILE_NUMBER_WIDTH, '0')}-${dataset}.sql`;

const optionalFields = (
  options: Pick<WriteSqlFilesOptions, 'exportUserId' | 'logoFileId'>,
): Pick<DatasetContext, 'exportUserId' | 'logoFileId'> => ({
  ...(options.exportUserId === undefined
    ? {}
    : { exportUserId: options.exportUserId }),
  ...(options.logoFileId === undefined
    ? {}
    : { logoFileId: options.logoFileId }),
});

// データセットを渡された順(依存の順)にSQLファイルへ書く。ファイルは投入の順に番号を付け、1つのファイルには1つのデータセットの文だけを置く
export async function writeSqlFiles(
  datasets: readonly SyntheticDataset[],
  profile: ScaleProfile,
  options: WriteSqlFilesOptions,
): Promise<SyntheticManifest> {
  const { outDir, maxStatementsPerFile } = options;
  if (!Number.isSafeInteger(maxStatementsPerFile) || maxStatementsPerFile < 1) {
    throw new RangeError(
      `maxStatementsPerFileは1以上の整数で指定してください: ${String(maxStatementsPerFile)}`,
    );
  }
  assertDatasetOrder(datasets);
  const context: DatasetContext = {
    seed: options.seed,
    baseDate: options.baseDate,
    ...optionalFields(options),
  };
  const samples = mergedSamples(datasets, profile, context);

  await mkdir(outDir, { recursive: true });
  await removePreviousOutput(outDir);

  const files: SyntheticManifestFile[] = [];
  const counts: Record<string, number> = {};
  const flush = async (dataset: string, lines: string[]): Promise<void> => {
    if (lines.length === 0) {
      return;
    }
    const content = `${lines.join('\n')}\n`;
    const order = files.length + 1;
    const name = fileNameOf(order, dataset);
    await writeFile(join(outDir, name), content);
    files.push({
      order,
      name,
      dataset,
      statements: lines.length,
      bytes: byteLengthOf(content),
    });
    lines.length = 0;
  };

  for (const dataset of datasets) {
    const lines: string[] = [];
    for (const statement of dataset.generate(profile, context)) {
      assertLine(statement.text, MAX_STATEMENT_BYTES);
      lines.push(statement.text);
      counts[statement.table] =
        (counts[statement.table] ?? 0) + statement.insertedRows;
      if (lines.length >= maxStatementsPerFile) {
        await flush(dataset.name, lines);
      }
    }
    await flush(dataset.name, lines);
  }

  const manifest: SyntheticManifest = {
    profile: profile.name,
    seed: options.seed,
    baseDate: options.baseDate,
    ...optionalFields(options),
    maxStatementsPerFile,
    maxStatementBytes: MAX_STATEMENT_BYTES,
    files,
    counts,
    samples,
  };
  await writeFile(
    join(outDir, MANIFEST_FILE_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}
