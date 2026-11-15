import { describe, expect, test } from 'bun:test';

import type { AuditLogSearchResult } from '../audit-log-reader.ts';
import { createFakeAuditLogReader } from './fake-audit-log-reader.ts';

const SEARCH_RESULT: AuditLogSearchResult = {
  entries: [
    {
      id: '01JAUDITLOG000000000000001',
      occurredAt: new Date('2026-11-03T12:00:00.000Z'),
      operatorAdminId: '01JBX8Y4Z5ABCDEFGHJKMNPQRS',
      action: 'admin-account.invite',
      targetKind: 'admin',
      targetIds: ['01JBX8Y4Z5ABCDEFGHJKMNPQRT'],
      reason: null,
      detail: {},
    },
  ],
  nextCursor: null,
};

const LATEST_QUERY = {
  action: 'product.suspend',
  targetKind: 'product',
  targetId: 'product-1',
} as const;

const LATEST_MANY_QUERY = {
  action: 'product.suspend',
  targetKind: 'product',
  targetIds: ['product-1', 'product-2'],
} as const;

describe('createFakeAuditLogReader', () => {
  test('既定では検索は空・1つの対象は記録なし・複数の対象は空の結果を返す', async () => {
    const reader = createFakeAuditLogReader();

    expect(await reader.search({}, { limit: 50 })).toEqual({
      entries: [],
      nextCursor: null,
    });
    expect(await reader.latestFor(LATEST_QUERY)).toBeUndefined();
    const many = await reader.latestForMany(LATEST_MANY_QUERY);
    expect(many.size).toBe(0);
  });

  test('渡したメソッドだけを差し替え、残りは既定の振る舞いを返す', async () => {
    const latest = new Date('2026-11-02T00:00:00.000Z');
    const queries: unknown[] = [];
    const reader = createFakeAuditLogReader({
      latestFor: (input) => {
        queries.push(input);
        return Promise.resolve(latest);
      },
    });

    expect(await reader.latestFor(LATEST_QUERY)).toBe(latest);
    expect(queries).toEqual([LATEST_QUERY]);
    expect(await reader.search({}, { limit: 50 })).toEqual({
      entries: [],
      nextCursor: null,
    });
    expect((await reader.latestForMany(LATEST_MANY_QUERY)).size).toBe(0);
  });

  test('すべてのメソッドを差し替えられる', async () => {
    const latestMany = new Map([['product-1', new Date(0)]]);
    const reader = createFakeAuditLogReader({
      search: () => Promise.resolve(SEARCH_RESULT),
      latestFor: () => Promise.resolve(new Date(1)),
      latestForMany: () => Promise.resolve(latestMany),
    });

    expect(await reader.search({}, { limit: 50 })).toBe(SEARCH_RESULT);
    expect(await reader.latestFor(LATEST_QUERY)).toEqual(new Date(1));
    expect(await reader.latestForMany(LATEST_MANY_QUERY)).toBe(latestMany);
  });

  test('呼び出しごとに別の結果の値を返し、テストの間で共有しない', async () => {
    const first = createFakeAuditLogReader();
    const second = createFakeAuditLogReader();

    const firstMany = await first.latestForMany(LATEST_MANY_QUERY);
    const secondMany = await second.latestForMany(LATEST_MANY_QUERY);

    expect(firstMany).not.toBe(secondMany);
  });
});
