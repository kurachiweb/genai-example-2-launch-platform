import { describe, expect, test } from 'bun:test';

import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';

import * as schema from './index.ts';

const exportedTableNames = Object.values(schema)
  .filter((value) => value instanceof SQLiteTable)
  .map((table) => getTableConfig(table).name);

describe('スキーマの集約点', () => {
  test.each([
    'email_suppressions',
    'email_send_records',
    'email_alert_throttles',
    'email_cleanup_cursors',
  ])(
    'マイグレーションの生成が読むテーブル定義として、%sを再エクスポートする',
    (tableName) => {
      expect(exportedTableNames).toContain(tableName);
    },
  );
});
