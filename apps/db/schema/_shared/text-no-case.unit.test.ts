import { describe, expect, test } from 'bun:test';

import { getTableConfig, snakeCase, text } from 'drizzle-orm/sqlite-core';

import { textNoCase } from './text-no-case.ts';

const probeHandles = snakeCase.table('probe_handles', {
  id: text().primaryKey(),
  displayHandle: textNoCase().notNull().unique(),
  aliasHandle: textNoCase(),
});

const columnsByName = new Map(
  getTableConfig(probeHandles).columns.map((column) => [column.name, column]),
);

describe('textNoCase', () => {
  test('照合順序nocaseのテキスト列になり、列名はスネークケースになる', () => {
    const displayHandle = columnsByName.get('display_handle');

    expect(displayHandle?.getSQLType()).toBe('text collate nocase');
    expect(displayHandle?.notNull).toBe(true);
    expect(displayHandle?.isUnique).toBe(true);
  });

  test('制約を付けなければNULLを許し、既定値と更新時の値を持たない', () => {
    const aliasHandle = columnsByName.get('alias_handle');

    expect(aliasHandle?.getSQLType()).toBe('text collate nocase');
    expect(aliasHandle?.notNull).toBe(false);
    expect(aliasHandle?.isUnique).toBe(false);
    expect(aliasHandle?.hasDefault).toBe(false);
    expect(aliasHandle?.defaultFn).toBeUndefined();
    expect(aliasHandle?.onUpdateFn).toBeUndefined();
  });

  test('文字列の値を変換せずにデータベースへ渡し、そのまま読み出す', () => {
    const displayHandle = columnsByName.get('display_handle');

    expect(displayHandle?.mapToDriverValue('Launch-Stadium')).toBe(
      'Launch-Stadium',
    );
    expect(displayHandle?.mapFromDriverValue('Launch-Stadium')).toBe(
      'Launch-Stadium',
    );
  });
});
