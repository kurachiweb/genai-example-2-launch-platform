import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { integer, snakeCase, text } from 'drizzle-orm/sqlite-core';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SMOKE_PROFILE } from './scale-profile.ts';
import {
  MAX_STATEMENT_BYTES,
  insertStatements,
  writeSqlFiles,
  type SqlRow,
  type SqlStatement,
  type SyntheticDataset,
} from './sql-writer.ts';

const probe = snakeCase.table('probe_documents', {
  id: text().primaryKey(),
  title: text().notNull(),
  body: text().notNull(),
  count: integer().notNull().default(0),
  flag: integer({ mode: 'boolean' }),
  at: integer({ mode: 'timestamp_ms' }),
  kind: text({ enum: ['a', 'b'] }),
});

const CREATE_PROBE =
  'CREATE TABLE probe_documents (id text PRIMARY KEY NOT NULL, title text NOT NULL, body text NOT NULL, count integer DEFAULT 0 NOT NULL, flag integer, at integer, kind text);';

const rejectionOf = async (promise: Promise<unknown>): Promise<Error> => {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error;
    }
    throw error;
  }
  throw new Error('例外になりませんでした');
};

const bytesOf = (statement: SqlStatement): number =>
  Buffer.byteLength(statement.text, 'utf8');

const rowOf = (overrides: Partial<SqlRow> = {}): SqlRow => ({
  id: 'a',
  title: 'タイトル',
  body: '本文',
  ...overrides,
});

const collect = (
  rows: readonly SqlRow[],
  options?: { maxStatementBytes?: number },
) => [...insertStatements(probe, rows, options)];

let db: Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.run(CREATE_PROBE);
});

afterEach(() => {
  db.close();
});

const applyAll = (statements: readonly SqlStatement[]): void => {
  for (const statement of statements) {
    db.run(statement.text);
  }
};

const bodyOf = (id: string): string | undefined =>
  db
    .query<{ body: string }, [string]>(
      'SELECT body FROM probe_documents WHERE id = ?',
    )
    .get(id)?.body;

describe('insertStatements', () => {
  test('1行ごとに1文のINSERTを、テーブル定義の列の順にリテラルで書く', () => {
    const statements = collect([
      rowOf({
        count: 3,
        flag: true,
        at: new Date(1_700_000_000_000),
        kind: 'a',
      }),
    ]);

    expect(statements).toEqual([
      {
        text: "INSERT INTO probe_documents (id, title, body, count, flag, at, kind) VALUES ('a', 'タイトル', '本文', 3, 1, 1700000000000, 'a');",
        table: 'probe_documents',
        insertedRows: 1,
      },
    ]);
  });

  test('SQLの既定値を持つ列は省略でき、省略した許容の列はNULLになる', () => {
    const [statement] = collect([rowOf({ flag: undefined, at: null })]);

    expect(statement?.text).toContain("'本文', 0, NULL, NULL, NULL);");
  });

  test('偽のフラグと0の数値を書き分ける', () => {
    const [statement] = collect([rowOf({ count: 0, flag: false })]);

    expect(statement?.text).toContain("'本文', 0, 0, NULL, NULL);");
  });

  test('引用符は二重にして、SQLiteへ適用すると元の値に戻る', () => {
    const value = "it's a ''test''";

    applyAll(collect([rowOf({ body: value })]));

    expect(bodyOf('a')).toBe(value);
  });

  test('改行とタブは置き換えの式で書き、1文を1行に保つ', () => {
    const value = '# 見出し\n\n- 項目\t1\r\n末尾';

    const statements = collect([rowOf({ body: value })]);

    expect(statements[0]?.text).not.toMatch(/[\n\r\t]/u);
    applyAll(statements);
    expect(bodyOf('a')).toBe(value);
  });

  test('改行だけの値も先頭と末尾が改行の値も元に戻る', () => {
    applyAll(
      collect([
        rowOf({ id: 'a', body: '\n' }),
        rowOf({ id: 'b', body: '\nx\n' }),
      ]),
    );

    expect(bodyOf('a')).toBe('\n');
    expect(bodyOf('b')).toBe('\nx\n');
  });

  test('空文字列は空のリテラルにする', () => {
    applyAll(collect([rowOf({ body: '' })]));

    expect(bodyOf('a')).toBe('');
  });

  test('改行とタブ以外の制御文字は例外にする', () => {
    expect(() => collect([rowOf({ body: 'a\u0000b' })])).toThrow();
    expect(() => collect([rowOf({ body: 'a\u001bb' })])).toThrow();
  });

  test('テーブルに無い列を指定すると例外にする', () => {
    expect(() => collect([rowOf({ titel: 'typo' })])).toThrow(/titel/u);
  });

  test('既定値の無いNOT NULLの列が無いと例外にする', () => {
    expect(() => collect([{ id: 'a', title: 'x' }])).toThrow(/body/u);
    expect(() => collect([rowOf({ title: null })])).toThrow(/title/u);
  });

  test('列の型と合わない値は例外にする', () => {
    expect(() => collect([rowOf({ count: 'many' })])).toThrow(/count/u);
    expect(() => collect([rowOf({ title: 3 })])).toThrow(/title/u);
    expect(() => collect([rowOf({ at: 'yesterday' })])).toThrow(/at/u);
  });

  test('列挙に無い文字列・整数でない数値・不正な日時は例外にする', () => {
    expect(() => collect([rowOf({ kind: 'c' })])).toThrow(/kind/u);
    expect(() => collect([rowOf({ count: 1.5 })])).toThrow(/count/u);
    expect(() =>
      collect([rowOf({ count: Number.MAX_SAFE_INTEGER + 2 })]),
    ).toThrow(/count/u);
    expect(() => collect([rowOf({ at: new Date(Number.NaN) })])).toThrow(/at/u);
  });

  test('上限を超える長い文字列は、最初の断片のINSERTと連結のUPDATEに分けて元の値に戻る', () => {
    const paragraph =
      "日本語の段落です。'引用符'を含み、絵文字😀と\n改行もあります。\n";
    const value = paragraph.repeat(10_000);

    const statements = collect([rowOf({ body: value })]);

    expect(statements.length).toBeGreaterThan(3);
    expect(
      statements.every(
        (statement) => bytesOf(statement) <= MAX_STATEMENT_BYTES,
      ),
    ).toBe(true);
    expect(statements[0]?.text.startsWith('INSERT INTO probe_documents')).toBe(
      true,
    );
    expect(
      statements
        .slice(1)
        .every((statement) =>
          statement.text.startsWith(
            'UPDATE probe_documents SET body = body || ',
          ),
        ),
    ).toBe(true);
    expect(statements.map((statement) => statement.insertedRows)).toEqual([
      1,
      ...statements.slice(1).map(() => 0),
    ]);
    applyAll(statements);
    expect(bodyOf('a')).toBe(value);
  });

  test('サロゲートペアの途中では分けない', () => {
    const value = '😀'.repeat(60_000);

    const statements = collect([rowOf({ body: value })]);

    expect(
      statements.every(
        (statement) =>
          !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
            statement.text,
          ),
      ),
    ).toBe(true);
    applyAll(statements);
    expect(bodyOf('a')).toBe(value);
  });

  test('2つの列が長いときも、それぞれの断片のUPDATEで元の値に戻る', () => {
    const title = 'タ'.repeat(40_000);
    const body = 'ボ'.repeat(70_000);

    const statements = collect([rowOf({ title, body })]);

    expect(
      statements.every(
        (statement) => bytesOf(statement) <= MAX_STATEMENT_BYTES,
      ),
    ).toBe(true);
    applyAll(statements);
    const row = db
      .query<{ title: string; body: string }, []>(
        'SELECT title, body FROM probe_documents',
      )
      .get();
    expect(row).toEqual({ title, body });
  });

  test('上限を引き下げると、より短い値でも分けて全ての文が上限以下になる', () => {
    const value = 'あ'.repeat(500);

    const statements = collect([rowOf({ body: value })], {
      maxStatementBytes: 400,
    });

    expect(statements.length).toBeGreaterThan(2);
    expect(statements.every((statement) => bytesOf(statement) <= 400)).toBe(
      true,
    );
    applyAll(statements);
    expect(bodyOf('a')).toBe(value);
  });

  test('長い文字列を除いても上限を超える行は例外にする', () => {
    expect(() =>
      collect([rowOf({ title: 'x', body: '' })], {
        maxStatementBytes: 100,
      }),
    ).toThrow(/上限/u);
  });

  test('複数の行を渡すと、行の順のまま1行ずつ文にする', () => {
    const statements = collect([
      rowOf({ id: 'a' }),
      rowOf({ id: 'b' }),
      rowOf({ id: 'c' }),
    ]);

    expect(statements.map((statement) => statement.insertedRows)).toEqual([
      1, 1, 1,
    ]);
    expect(
      statements.map(
        (statement) => /VALUES \('(.)'/u.exec(statement.text)?.[1],
      ),
    ).toEqual(['a', 'b', 'c']);
  });
});

describe('writeSqlFiles', () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'synthetic-writer-'));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  const rowsDataset = (
    name: string,
    count: number,
    dependsOn: readonly string[] = [],
    samples?: Readonly<Record<string, readonly string[]>>,
  ): SyntheticDataset => ({
    name,
    dependsOn,
    *generate() {
      for (let index = 0; index < count; index += 1) {
        yield* insertStatements(probe, [
          rowOf({ id: `${name}-${String(index).padStart(6, '0')}` }),
        ]);
      }
    },
    ...(samples === undefined ? {} : { samples: () => samples }),
  });

  const options = (
    overrides: Partial<Parameters<typeof writeSqlFiles>[2]> = {},
  ) => ({
    outDir,
    seed: 1,
    baseDate: '2026-11-24',
    maxStatementsPerFile: 5_000,
    ...overrides,
  });

  const sqlFiles = async (): Promise<string[]> =>
    (await readdir(outDir)).filter((name) => name.endsWith('.sql')).toSorted();

  test('1ファイルの文の数が上限を超えないように、投入の順に番号を付けたファイルへ分ける', async () => {
    const manifest = await writeSqlFiles(
      [rowsDataset('alpha', 12_001)],
      SMOKE_PROFILE,
      options(),
    );

    expect(await sqlFiles()).toEqual([
      '0001-alpha.sql',
      '0002-alpha.sql',
      '0003-alpha.sql',
    ]);
    expect(manifest.files.map((file) => file.statements)).toEqual([
      5_000, 5_000, 2_001,
    ]);
    for (const file of manifest.files) {
      const content = await readFile(join(outDir, file.name), 'utf8');
      const lines = content.split('\n');
      expect(lines.at(-1)).toBe('');
      expect(lines.length - 1).toBe(file.statements);
      expect(Buffer.byteLength(content, 'utf8')).toBe(file.bytes);
    }
  });

  test('データセットが変わるとファイルを分け、依存の順に並べる', async () => {
    const manifest = await writeSqlFiles(
      [rowsDataset('alpha', 2), rowsDataset('beta', 3, ['alpha'])],
      SMOKE_PROFILE,
      options(),
    );

    expect(
      manifest.files.map((file) => [
        file.order,
        file.name,
        file.dataset,
        file.statements,
      ]),
    ).toEqual([
      [1, '0001-alpha.sql', 'alpha', 2],
      [2, '0002-beta.sql', 'beta', 3],
    ]);
  });

  test('manifestはプロファイル・種・基準日・件数・見本を持ち、manifest.jsonと一致する', async () => {
    const manifest = await writeSqlFiles(
      [
        rowsDataset('alpha', 2, [], { aliases: ['x', 'y'] }),
        rowsDataset('beta', 3, ['alpha'], { others: ['z'] }),
      ],
      SMOKE_PROFILE,
      options({
        seed: 7,
        baseDate: '2026-12-01',
        exportUserId: '01JCDEFGHJKMNPQRSTVWXYZ012',
      }),
    );

    expect(manifest).toMatchObject({
      profile: 'smoke',
      seed: 7,
      baseDate: '2026-12-01',
      exportUserId: '01JCDEFGHJKMNPQRSTVWXYZ012',
      maxStatementsPerFile: 5_000,
      maxStatementBytes: MAX_STATEMENT_BYTES,
      counts: { probe_documents: 5 },
      samples: { aliases: ['x', 'y'], others: ['z'] },
    });
    expect(
      JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8')),
    ).toEqual(JSON.parse(JSON.stringify(manifest)));
  });

  test('manifestのキーは設計の論理データモデルに合い、生成の日時を含まない', async () => {
    const manifest = await writeSqlFiles(
      [rowsDataset('alpha', 1)],
      SMOKE_PROFILE,
      options(),
    );

    expect(Object.keys(manifest).toSorted()).toEqual(
      [
        'baseDate',
        'counts',
        'files',
        'maxStatementBytes',
        'maxStatementsPerFile',
        'profile',
        'samples',
        'seed',
      ].toSorted(),
    );
    expect(Object.keys(manifest.files[0] ?? {}).toSorted()).toEqual([
      'bytes',
      'dataset',
      'name',
      'order',
      'statements',
    ]);
  });

  test('同じ種と基準日なら、ファイルもmanifestも同じ内容になる', async () => {
    const run = async (): Promise<string[]> => {
      await writeSqlFiles([rowsDataset('alpha', 20)], SMOKE_PROFILE, options());
      return Promise.all(
        [...(await sqlFiles()), 'manifest.json'].map((name) =>
          readFile(join(outDir, name), 'utf8'),
        ),
      );
    };

    const first = await run();
    const second = await run();

    expect(second).toEqual(first);
  });

  test('前の出力のSQLファイルは消し、無関係のファイルは残す', async () => {
    await writeFile(join(outDir, '0009-stale.sql'), 'SELECT 1;\n');
    await writeFile(join(outDir, 'notes.txt'), 'keep');

    await writeSqlFiles([rowsDataset('alpha', 1)], SMOKE_PROFILE, options());

    expect(await sqlFiles()).toEqual(['0001-alpha.sql']);
    expect(await readFile(join(outDir, 'notes.txt'), 'utf8')).toBe('keep');
  });

  test('出力先のディレクトリが無ければ作る', async () => {
    const nested = join(outDir, 'a', 'b');

    await writeSqlFiles(
      [rowsDataset('alpha', 1)],
      SMOKE_PROFILE,
      options({ outDir: nested }),
    );

    expect(await readdir(nested)).toContain('manifest.json');
  });

  test('データセットにプロファイルと種・基準日・既存の利用者のIDを渡す', async () => {
    const seen: unknown[] = [];
    const dataset: SyntheticDataset = {
      name: 'spy',
      dependsOn: [],
      generate(profile, context) {
        seen.push(profile.name, context);
        return [];
      },
    };

    await writeSqlFiles(
      [dataset],
      SMOKE_PROFILE,
      options({
        seed: 5,
        exportUserId: '01JCDEFGHJKMNPQRSTVWXYZ012',
        logoFileId: 'logo-1',
      }),
    );

    expect(seen).toEqual([
      'smoke',
      {
        seed: 5,
        baseDate: '2026-11-24',
        exportUserId: '01JCDEFGHJKMNPQRSTVWXYZ012',
        logoFileId: 'logo-1',
      },
    ]);
  });

  test('依存先が前に無い・名前が重複するときは、何も書かずに例外にする', async () => {
    expect(
      (
        await rejectionOf(
          writeSqlFiles(
            [rowsDataset('beta', 1, ['alpha'])],
            SMOKE_PROFILE,
            options(),
          ),
        )
      ).message,
    ).toMatch(/alpha/u);
    expect(
      (
        await rejectionOf(
          writeSqlFiles(
            [rowsDataset('beta', 1, ['alpha']), rowsDataset('alpha', 1)],
            SMOKE_PROFILE,
            options(),
          ),
        )
      ).message,
    ).toMatch(/alpha/u);
    expect(
      (
        await rejectionOf(
          writeSqlFiles(
            [rowsDataset('alpha', 1), rowsDataset('alpha', 1)],
            SMOKE_PROFILE,
            options(),
          ),
        )
      ).message,
    ).toMatch(/重複/u);
    expect(await readdir(outDir)).toEqual([]);
  });

  test('見本の名前が重なると例外にする', async () => {
    expect(
      (
        await rejectionOf(
          writeSqlFiles(
            [
              rowsDataset('alpha', 1, [], { aliases: ['x'] }),
              rowsDataset('beta', 1, ['alpha'], { aliases: ['y'] }),
            ],
            SMOKE_PROFILE,
            options(),
          ),
        )
      ).message,
    ).toMatch(/aliases/u);
  });

  test('上限を超える文と複数行の文を出力する前に検出して例外にする', async () => {
    const make = (text: string): SyntheticDataset => ({
      name: 'bad',
      dependsOn: [],
      generate: () => [{ text, table: 'probe_documents', insertedRows: 1 }],
    });

    expect(
      (
        await rejectionOf(
          writeSqlFiles(
            [make(`SELECT '${'x'.repeat(MAX_STATEMENT_BYTES)}';`)],
            SMOKE_PROFILE,
            options(),
          ),
        )
      ).message,
    ).toMatch(/バイト/u);
    expect(
      (
        await rejectionOf(
          writeSqlFiles(
            [make('SELECT 1;\nSELECT 2;')],
            SMOKE_PROFILE,
            options(),
          ),
        )
      ).message,
    ).toMatch(/改行/u);
    expect(
      (
        await rejectionOf(
          writeSqlFiles([make('SELECT 1')], SMOKE_PROFILE, options()),
        )
      ).message,
    ).toMatch(/;/u);
  });

  test('1ファイルの文の上限が正の整数でなければ例外にする', async () => {
    expect(
      (
        await rejectionOf(
          writeSqlFiles(
            [rowsDataset('alpha', 1)],
            SMOKE_PROFILE,
            options({ maxStatementsPerFile: 0 }),
          ),
        )
      ).message,
    ).toMatch(/maxStatementsPerFile/u);
  });

  test('出力したファイルを順に適用すると、全ての行が入る', async () => {
    const manifest = await writeSqlFiles(
      [rowsDataset('alpha', 30)],
      SMOKE_PROFILE,
      options({ maxStatementsPerFile: 7 }),
    );

    for (const file of manifest.files) {
      db.run(await readFile(join(outDir, file.name), 'utf8'));
    }

    expect(
      db
        .query<{ n: number }, []>('SELECT count(*) AS n FROM probe_documents')
        .get()?.n,
    ).toBe(30);
    expect(manifest.files.map((file) => file.statements)).toEqual([
      7, 7, 7, 7, 2,
    ]);
  });
});
