import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type {
  ProductDirectory,
  ProductHandleResolution,
} from '../../../lib/core/product/ports.ts';
import {
  OWNER_ID,
  PRODUCT_HANDLE,
  PRODUCT_ID,
  STRANGER_ID,
  summaryOf,
  viewerOf,
} from '../directory/testing/product-page-fakes.ts';
import { SourcedProductTrophyReader } from './product-trophy-reader.ts';
import type {
  RegisteredTrophySource,
  TrophyRecord,
  TrophySource,
} from './trophy-source.ts';

const records: LogRecord[] = [];

beforeEach(() => {
  records.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ['api'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

const weekTrophy = (period: string, awardedAt: string): TrophyRecord => ({
  kind: 'week',
  period,
  periodLabel: `${period}の表記`,
  awardedAt: new Date(awardedAt),
  bracketPath: `/tournaments/week/${period}`,
});

const yearTrophy = (period: string, awardedAt: string): TrophyRecord => ({
  kind: 'year',
  period,
  periodLabel: `${period}年`,
  awardedAt: new Date(awardedAt),
  bracketPath: null,
});

const current = (
  overrides: Parameters<typeof summaryOf>[1] = {},
): ProductHandleResolution => ({
  kind: 'current',
  product: summaryOf(PRODUCT_ID, overrides),
});

function productsOf(resolution: ProductHandleResolution) {
  const resolved: string[] = [];
  const unexpected = (): never => {
    throw new Error('呼ばれない想定の照会');
  };
  const products: ProductDirectory = {
    resolveHandle: (handle) => {
      resolved.push(handle);
      return Promise.resolve(resolution);
    },
    findSummaries: unexpected,
    findDetail: unexpected,
    listLaunches: unexpected,
  };
  return { products, resolved };
}

function sourcesOf(
  specs: readonly {
    readonly name: string;
    readonly listTrophies: () => Promise<readonly TrophyRecord[]>;
  }[],
) {
  const calls: { readonly name: string; readonly productId: string }[] = [];
  const sources: readonly RegisteredTrophySource[] = specs.map(
    ({ name, listTrophies }) => {
      const source: TrophySource = {
        listTrophies: (productId) => {
          calls.push({ name, productId });
          return listTrophies();
        },
      };
      return { name, source };
    },
  );
  return { sources, calls };
}

const trophiesOf =
  (
    trophies: readonly TrophyRecord[],
  ): (() => Promise<readonly TrophyRecord[]>) =>
  () =>
    Promise.resolve(trophies);

describe('ProductTrophyReader.read', () => {
  test('詳細ページを表示できるプロダクトのIDで全ての供給元を呼び、Yearを先頭に同じ種類は受賞の新しい順に並べる', async () => {
    const { products, resolved } = productsOf(current());
    const { sources, calls } = sourcesOf([
      {
        name: 'tournament-year.year-trophies',
        listTrophies: trophiesOf([
          yearTrophy('2025', '2025-12-28T15:00:00.000Z'),
          yearTrophy('2026', '2026-12-27T15:00:00.000Z'),
        ]),
      },
      {
        name: 'tournament-week.week-trophies',
        listTrophies: trophiesOf([
          weekTrophy('2026-W10', '2026-03-08T14:45:00.000Z'),
          weekTrophy('2026-W37', '2026-09-13T14:45:00.000Z'),
          weekTrophy('2026-W20', '2026-05-17T14:45:00.000Z'),
        ]),
      },
    ]);
    const reader = new SourcedProductTrophyReader(products, sources);

    const trophies = await reader.read(PRODUCT_HANDLE, undefined);

    expect(resolved).toStrictEqual([PRODUCT_HANDLE]);
    expect(calls).toStrictEqual([
      { name: 'tournament-year.year-trophies', productId: PRODUCT_ID },
      { name: 'tournament-week.week-trophies', productId: PRODUCT_ID },
    ]);
    expect(trophies).toStrictEqual([
      yearTrophy('2026', '2026-12-27T15:00:00.000Z'),
      yearTrophy('2025', '2025-12-28T15:00:00.000Z'),
      weekTrophy('2026-W37', '2026-09-13T14:45:00.000Z'),
      weekTrophy('2026-W20', '2026-05-17T14:45:00.000Z'),
      weekTrophy('2026-W10', '2026-03-08T14:45:00.000Z'),
    ]);
  });

  test('登録の順によらず、Weekの供給元が先でもYearを先頭に置く', async () => {
    const { products } = productsOf(current());
    const { sources } = sourcesOf([
      {
        name: 'tournament-week.week-trophies',
        listTrophies: trophiesOf([
          weekTrophy('2026-W37', '2026-09-13T14:45:00.000Z'),
        ]),
      },
      {
        name: 'tournament-year.year-trophies',
        listTrophies: trophiesOf([
          yearTrophy('2025', '2025-12-28T15:00:00.000Z'),
        ]),
      },
    ]);
    const reader = new SourcedProductTrophyReader(products, sources);

    const trophies = await reader.read(PRODUCT_HANDLE, undefined);

    expect(trophies).toStrictEqual([
      yearTrophy('2025', '2025-12-28T15:00:00.000Z'),
      weekTrophy('2026-W37', '2026-09-13T14:45:00.000Z'),
    ]);
  });

  test('受賞の日時が同じなら期間の新しい順に並べる', async () => {
    const { products } = productsOf(current());
    const { sources } = sourcesOf([
      {
        name: 'tournament-week.week-trophies',
        listTrophies: trophiesOf([
          weekTrophy('2026-W36', '2026-09-13T14:45:00.000Z'),
          weekTrophy('2026-W37', '2026-09-13T14:45:00.000Z'),
        ]),
      },
    ]);
    const reader = new SourcedProductTrophyReader(products, sources);

    const trophies = await reader.read(PRODUCT_HANDLE, undefined);

    expect(trophies?.map(({ period }) => period)).toStrictEqual([
      '2026-W37',
      '2026-W36',
    ]);
  });

  test('受賞が無ければ空の一覧を返す', async () => {
    const { products } = productsOf(current());
    const { sources } = sourcesOf([
      { name: 'tournament-week.week-trophies', listTrophies: trophiesOf([]) },
    ]);
    const reader = new SourcedProductTrophyReader(products, sources);

    expect(await reader.read(PRODUCT_HANDLE, undefined)).toStrictEqual([]);
  });

  test('登録された供給元が無ければ空の一覧を返す', async () => {
    const { products } = productsOf(current());
    const reader = new SourcedProductTrophyReader(products, []);

    expect(await reader.read(PRODUCT_HANDLE, undefined)).toStrictEqual([]);
  });

  test('供給元の失敗はその供給元の受賞だけを欠落させ、供給元の名前だけをwarningのログに残す', async () => {
    const { products } = productsOf(current());
    const { sources } = sourcesOf([
      {
        name: 'tournament-year.year-trophies',
        listTrophies: () =>
          Promise.reject(new Error('内部の値 user@mail.example')),
      },
      {
        name: 'tournament-week.week-trophies',
        listTrophies: trophiesOf([
          weekTrophy('2026-W37', '2026-09-13T14:45:00.000Z'),
        ]),
      },
    ]);
    const reader = new SourcedProductTrophyReader(products, sources);

    const trophies = await reader.read(PRODUCT_HANDLE, undefined);

    expect(trophies).toStrictEqual([
      weekTrophy('2026-W37', '2026-09-13T14:45:00.000Z'),
    ]);
    const warnings = records.filter(({ level }) => level === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.properties).toStrictEqual({
      sourceName: 'tournament-year.year-trophies',
    });
  });

  test('全ての供給元が失敗しても例外を投げずに空の一覧を返す', async () => {
    const { products } = productsOf(current());
    const { sources } = sourcesOf([
      {
        name: 'tournament-week.week-trophies',
        listTrophies: () => Promise.reject(new Error('失敗')),
      },
    ]);
    const reader = new SourcedProductTrophyReader(products, sources);

    expect(await reader.read(PRODUCT_HANDLE, undefined)).toStrictEqual([]);
  });

  test('未掲載のプロダクトは投稿者本人にだけ受賞を返す', async () => {
    const trophy = weekTrophy('2026-W37', '2026-09-13T14:45:00.000Z');
    const { products } = productsOf(current({ listed: false }));
    const { sources } = sourcesOf([
      {
        name: 'tournament-week.week-trophies',
        listTrophies: trophiesOf([trophy]),
      },
    ]);
    const reader = new SourcedProductTrophyReader(products, sources);

    expect(await reader.read(PRODUCT_HANDLE, viewerOf(OWNER_ID))).toStrictEqual(
      [trophy],
    );
    expect(await reader.read(PRODUCT_HANDLE, viewerOf(STRANGER_ID))).toBeNull();
    expect(await reader.read(PRODUCT_HANDLE, undefined)).toBeNull();
  });

  test.each([
    ['存在しない', { kind: 'none' }],
    ['可視でない', current({ visible: false, hidden: true })],
    [
      '旧ハンドルで解決した',
      { kind: 'previous', product: summaryOf(PRODUCT_ID) },
    ],
  ] as const satisfies readonly (readonly [string, ProductHandleResolution])[])(
    '%sプロダクトは詳細ページの公開範囲で見えないため、供給元を呼ばずにnullを返す',
    async (_name, resolution) => {
      const { products } = productsOf(resolution);
      const { sources, calls } = sourcesOf([
        { name: 'tournament-week.week-trophies', listTrophies: trophiesOf([]) },
      ]);
      const reader = new SourcedProductTrophyReader(products, sources);

      expect(await reader.read(PRODUCT_HANDLE, viewerOf(OWNER_ID))).toBeNull();
      expect(calls).toStrictEqual([]);
    },
  );

  test('形式に合わないハンドルは照会をせずにnullを返す', async () => {
    const { products, resolved } = productsOf(current());
    const { sources, calls } = sourcesOf([
      { name: 'tournament-week.week-trophies', listTrophies: trophiesOf([]) },
    ]);
    const reader = new SourcedProductTrophyReader(products, sources);

    expect(await reader.read('Not A Handle!', undefined)).toBeNull();
    expect(resolved).toStrictEqual([]);
    expect(calls).toStrictEqual([]);
  });
});
