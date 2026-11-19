import { describe, expect, test } from 'bun:test';
import { snakeCase, text } from 'drizzle-orm/sqlite-core';

import { createDatabase } from './client.ts';

const items = snakeCase.table('items', { id: text().primaryKey() });

// 最初の1回だけロックの競合で失敗し、2回目からは空の結果を返す偽のD1
function createOnceLockedD1() {
  let failed = false;
  const calls: string[] = [];
  const result = <T>(name: string, value: T): Promise<T> => {
    calls.push(name);
    if (!failed) {
      failed = true;
      return Promise.reject(
        new Error('D1_ERROR: database is locked: SQLITE_BUSY'),
      );
    }
    return Promise.resolve(value);
  };
  const statement = {
    bind: () => statement,
    first: () => result('first', null),
    run: () => result('run', { success: true, meta: {}, results: [] }),
    all: () => result('all', { success: true, meta: {}, results: [] }),
    raw: () => result('raw', []),
  };
  const d1 = {
    prepare: () => statement,
    batch: () => result('batch', []),
    exec: () => result('exec', { count: 0, duration: 0 }),
  } as unknown as D1Database;
  return { d1, calls };
}

describe('createDatabase', () => {
  test('ロックの競合で失敗した問い合わせを、呼び出し元へ失敗を返さずにやり直し、やり直しを知らせる', async () => {
    const { d1, calls } = createOnceLockedD1();
    const retried: number[] = [];
    const db = createDatabase(d1, {
      sleep: () => Promise.resolve(),
      onRetry: (_error, delayMs) => retried.push(delayMs),
    });

    const rows = await db.select().from(items);

    expect(rows).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(retried).toHaveLength(1);
  });
});
