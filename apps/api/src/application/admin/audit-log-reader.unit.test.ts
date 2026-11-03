import { describe, expect, test } from 'bun:test';

import { Container } from 'inversify';

import { ADMIN_TYPES } from './admin-types.ts';
import {
  type AuditLogFilter,
  type AuditLogLatestManyQuery,
  type AuditLogLatestQuery,
  type AuditLogPageRequest,
  type AuditLogReader,
  type AuditLogSearchResult,
  StoreAuditLogReader,
} from './audit-log-reader.ts';
import type { AuditLogStore } from './ports.ts';

const OPERATOR_ADMIN_ID = '01JBX8Y4Z5ABCDEFGHJKMNPQRS';

const PRODUCT_IDS = ['product-1', 'product-2', 'product-3'] as const;

const SEARCH_RESULT: AuditLogSearchResult = {
  entries: [
    {
      id: '01JAUDITLOG000000000000002',
      occurredAt: new Date('2026-11-03T12:00:00.000Z'),
      operatorAdminId: OPERATOR_ADMIN_ID,
      action: 'admin-account.invite',
      targetKind: 'admin',
      targetIds: ['01JBX8Y4Z5ABCDEFGHJKMNPQRT'],
      reason: null,
      detail: {},
    },
  ],
  nextCursor: 'MTc5MzcyNjAwMDAwMDowMUpBVURJVExPRzAwMDAwMDAwMDAwMDAwMg',
};

interface Recorded {
  readonly searches: {
    readonly filter: AuditLogFilter;
    readonly page: AuditLogPageRequest;
  }[];
  readonly latestQueries: AuditLogLatestQuery[];
  readonly latestManyQueries: AuditLogLatestManyQuery[];
}

interface FakeOptions {
  readonly latest?: Date | undefined;
  readonly latestMany?: ReadonlyMap<string, Date>;
}

function setup(options: FakeOptions = {}) {
  const recorded: Recorded = {
    searches: [],
    latestQueries: [],
    latestManyQueries: [],
  };
  const store: AuditLogStore = {
    insert: () => Promise.reject(new Error('保存は呼ばれない想定です')),
    search: (filter, page) => {
      recorded.searches.push({ filter, page });
      return Promise.resolve(SEARCH_RESULT);
    },
    latestFor: (input) => {
      recorded.latestQueries.push(input);
      return Promise.resolve(options.latest);
    },
    latestForMany: (input) => {
      recorded.latestManyQueries.push(input);
      return Promise.resolve(options.latestMany ?? new Map());
    },
  };
  const reader = new StoreAuditLogReader(store);
  return { reader, recorded, store };
}

describe('StoreAuditLogReader.search', () => {
  test('絞り込みの条件とカーソルをストアへ渡し、結果をそのまま返す', async () => {
    const { reader, recorded } = setup();
    const filter: AuditLogFilter = {
      operatorAdminId: OPERATOR_ADMIN_ID,
      action: 'admin-account.invite',
      targetId: '01JBX8Y4Z5ABCDEFGHJKMNPQRT',
      occurredFrom: new Date('2026-11-01T00:00:00.000Z'),
      occurredBefore: new Date('2026-11-04T00:00:00.000Z'),
    };

    const result = await reader.search(filter, {
      after: 'MTc5MzcyNjAwMDAwMDowMUpBVURJVExPRzAwMDAwMDAwMDAwMDAwMw',
      limit: 50,
    });

    expect(result).toBe(SEARCH_RESULT);
    expect(recorded.searches).toEqual([
      {
        filter,
        page: {
          after: 'MTc5MzcyNjAwMDAwMDowMUpBVURJVExPRzAwMDAwMDAwMDAwMDAwMw',
          limit: 50,
        },
      },
    ]);
  });

  test('カーソルが無い最初のページは条件なしでもストアへ渡す', async () => {
    const { reader, recorded } = setup();

    await reader.search({}, { limit: 50 });

    expect(recorded.searches).toEqual([{ filter: {}, page: { limit: 50 } }]);
  });
});

describe('StoreAuditLogReader.latestFor', () => {
  test('操作種別と1つの対象の最新の日時をストアに問い合わせて返す', async () => {
    const latest = new Date('2026-11-02T08:00:00.000Z');
    const { reader, recorded } = setup({ latest });
    const query: AuditLogLatestQuery = {
      action: 'admin-account.invite',
      targetKind: 'admin',
      targetId: '01JBX8Y4Z5ABCDEFGHJKMNPQRT',
    };

    expect(await reader.latestFor(query)).toBe(latest);
    expect(recorded.latestQueries).toEqual([query]);
  });

  test('記録が無ければundefinedを返す', async () => {
    const { reader } = setup({ latest: undefined });

    expect(
      await reader.latestFor({
        action: 'admin-account.invite',
        targetKind: 'admin',
        targetId: '01JBX8Y4Z5ABCDEFGHJKMNPQRT',
      }),
    ).toBeUndefined();
  });
});

describe('StoreAuditLogReader.latestForMany', () => {
  test('重複を除いた対象のIDを最初の出現の順でストアへ渡し、結果を返す', async () => {
    const latestMany = new Map([
      [PRODUCT_IDS[0], new Date('2026-11-01T00:00:00.000Z')],
    ]);
    const { reader, recorded } = setup({ latestMany });

    const result = await reader.latestForMany({
      action: 'product.suspend',
      targetKind: 'product',
      targetIds: [
        PRODUCT_IDS[1],
        PRODUCT_IDS[0],
        PRODUCT_IDS[1],
        PRODUCT_IDS[2],
      ],
    });

    expect(result).toBe(latestMany);
    expect(recorded.latestManyQueries).toEqual([
      {
        action: 'product.suspend',
        targetKind: 'product',
        targetIds: [PRODUCT_IDS[1], PRODUCT_IDS[0], PRODUCT_IDS[2]],
      },
    ]);
  });

  test('空の入力ではストアに問い合わせず、空の結果を返す', async () => {
    const { reader, recorded } = setup();

    const result = await reader.latestForMany({
      action: 'product.suspend',
      targetKind: 'product',
      targetIds: [],
    });

    expect(result.size).toBe(0);
    expect(recorded.latestManyQueries).toHaveLength(0);
  });
});

describe('StoreAuditLogReader', () => {
  test('コンテナで依存を注入して解決できる', async () => {
    const { store } = setup();
    const container = new Container();
    container
      .bind<AuditLogStore>(ADMIN_TYPES.AuditLogStore)
      .toConstantValue(store);
    container
      .bind<AuditLogReader>(ADMIN_TYPES.AuditLogReader)
      .to(StoreAuditLogReader);

    const reader = container.get<AuditLogReader>(ADMIN_TYPES.AuditLogReader);

    expect(await reader.search({}, { limit: 50 })).toBe(SEARCH_RESULT);
  });
});
