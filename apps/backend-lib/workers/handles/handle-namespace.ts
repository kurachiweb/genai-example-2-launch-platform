import { getTableColumns, getTableName, type SQL } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';

import type { HandleRule } from '../../../common-lib/handles/handle-rules.ts';

export interface HandleSource {
  readonly table: SQLiteTable;
  readonly ownerId: SQLiteColumn;
  readonly handle: SQLiteColumn;
  readonly activeCondition?: SQL;
  readonly deletedAt?: SQLiteColumn;
}

export interface HandleNamespace {
  readonly name: string;
  readonly rule: HandleRule;
  readonly current: HandleSource;
  readonly previous?: HandleSource;
}

export interface PreviousHandleSource extends HandleSource {
  readonly deletedAt: SQLiteColumn;
  readonly id: SQLiteColumn;
  readonly createdAt: SQLiteColumn;
  readonly updatedAt: SQLiteColumn;
}

const NAMESPACE_NAME_PATTERN = /^[a-z][a-z0-9-]*$/u;

function assertColumnsBelongToTable(label: string, source: HandleSource): void {
  const tableColumns: readonly unknown[] = Object.values(
    getTableColumns(source.table),
  );
  const columns = [source.ownerId, source.handle, source.deletedAt];
  for (const column of columns) {
    if (column !== undefined && !tableColumns.includes(column)) {
      throw new Error(
        `${label}の列${column.name}がテーブル${getTableName(source.table)}の列ではありません`,
      );
    }
  }
}

// 旧ハンドルの挿入と論理削除が列を名前で引くため、共通の列定義が作る主キーと日時の列の名前で探す
function resolvePreviousSource(source: HandleSource): PreviousHandleSource {
  assertColumnsBelongToTable('旧ハンドル', source);
  const { deletedAt } = source;
  if (deletedAt === undefined) {
    throw new Error('旧ハンドルには論理削除の列が必要です');
  }
  const columns: Record<string, SQLiteColumn | undefined> = getTableColumns(
    source.table,
  );
  const { id, createdAt, updatedAt } = columns;
  if (id === undefined || createdAt === undefined || updatedAt === undefined) {
    throw new Error(
      '旧ハンドルのテーブルにはid・createdAt・updatedAtの列が必要です',
    );
  }
  return { ...source, deletedAt, id, createdAt, updatedAt };
}

export function defineHandleNamespace(ns: HandleNamespace): HandleNamespace {
  if (!NAMESPACE_NAME_PATTERN.test(ns.name)) {
    throw new Error(`ハンドルの名前空間の名前が不正です: ${ns.name}`);
  }
  if (!Number.isInteger(ns.rule.maxLength) || ns.rule.maxLength < 1) {
    throw new Error('ハンドルの上限は1以上の整数にしてください');
  }
  assertColumnsBelongToTable('現在のハンドル', ns.current);
  if (ns.previous !== undefined) {
    resolvePreviousSource(ns.previous);
  }
  return ns;
}

export function requirePreviousSource(
  ns: HandleNamespace,
): PreviousHandleSource | undefined {
  return ns.previous === undefined
    ? undefined
    : resolvePreviousSource(ns.previous);
}
