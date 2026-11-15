import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import { DIRECTORY_PAGE_SIZE } from '../../../common-lib/directory/directory-query-rules.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import type {
  DirectoryItemMetricSource,
  RegisteredItemMetricSource,
} from './item-metric-sources.ts';
import { SourcedItemMetricsReader } from './item-metrics-reader.ts';

const AT = fromBusinessDateTime(parseBusinessDate('2026-11-10'), {
  hour: 12,
  minute: 0,
});

const PRODUCT_A = '01JD0PROD00000000000000001';
const PRODUCT_B = '01JD0PROD00000000000000002';
const PRODUCT_OUTSIDE = '01JD0PROD00000000000000009';

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

type MetricsInput = Parameters<DirectoryItemMetricSource['metrics']>[0];

function sourcesOf(
  specs: readonly {
    readonly key: string;
    readonly metrics: () => Promise<ReadonlyMap<string, number>>;
  }[],
) {
  const calls: { readonly key: string; readonly input: MetricsInput }[] = [];
  const sources: readonly RegisteredItemMetricSource[] = specs.map(
    ({ key, metrics }) => ({
      name: `spec-test.${key}`,
      key,
      source: {
        metrics: (input) => {
          calls.push({ key, input });
          return metrics();
        },
      },
    }),
  );
  return { sources, calls };
}

const valuesOf =
  (
    entries: readonly (readonly [string, number])[],
  ): (() => Promise<ReadonlyMap<string, number>>) =>
  () =>
    Promise.resolve(new Map(entries));

describe('ItemMetricsReader.read', () => {
  test('供給元を登録の順に1回ずつ、全てのプロダクトと判定の時刻を渡して呼び、プロダクトごとに登録の順で値を並べる', async () => {
    const { sources, calls } = sourcesOf([
      {
        key: 'comments',
        metrics: valuesOf([
          [PRODUCT_A, 3],
          [PRODUCT_B, 0],
        ]),
      },
      { key: 'reviews', metrics: valuesOf([[PRODUCT_A, 5]]) },
    ]);
    const reader = new SourcedItemMetricsReader(sources);

    const metrics = await reader.read([PRODUCT_A, PRODUCT_B], AT);

    expect(calls).toStrictEqual([
      {
        key: 'comments',
        input: { productIds: [PRODUCT_A, PRODUCT_B], at: AT },
      },
      { key: 'reviews', input: { productIds: [PRODUCT_A, PRODUCT_B], at: AT } },
    ]);
    expect([...metrics]).toStrictEqual([
      [
        PRODUCT_A,
        [
          { key: 'comments', value: 3 },
          { key: 'reviews', value: 5 },
        ],
      ],
      [PRODUCT_B, [{ key: 'comments', value: 0 }]],
    ]);
  });

  test('渡していないプロダクトの値は捨てる', async () => {
    const { sources } = sourcesOf([
      {
        key: 'comments',
        metrics: valuesOf([
          [PRODUCT_A, 3],
          [PRODUCT_OUTSIDE, 7],
        ]),
      },
    ]);
    const reader = new SourcedItemMetricsReader(sources);

    const metrics = await reader.read([PRODUCT_A], AT);

    expect([...metrics]).toStrictEqual([
      [PRODUCT_A, [{ key: 'comments', value: 3 }]],
    ]);
  });

  test('供給元の失敗はその値だけを欠落させ、警告のログに供給元の名前だけを残す', async () => {
    const { sources, calls } = sourcesOf([
      {
        key: 'comments',
        metrics: () =>
          Promise.reject(new Error('利用者のメールアドレスを含む失敗の詳細')),
      },
      { key: 'reviews', metrics: valuesOf([[PRODUCT_A, 5]]) },
    ]);
    const reader = new SourcedItemMetricsReader(sources);

    const metrics = await reader.read([PRODUCT_A, PRODUCT_B], AT);

    expect(calls).toHaveLength(2);
    expect([...metrics]).toStrictEqual([
      [PRODUCT_A, [{ key: 'reviews', value: 5 }]],
      [PRODUCT_B, []],
    ]);
    const warnings = records.filter(({ level }) => level === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.properties).toStrictEqual({
      sourceName: 'spec-test.comments',
    });
  });

  test('供給元が登録されていなければ、全てのプロダクトを値の無い項目にする', async () => {
    const reader = new SourcedItemMetricsReader([]);

    const metrics = await reader.read([PRODUCT_A], AT);

    expect([...metrics]).toStrictEqual([[PRODUCT_A, []]]);
  });

  test('プロダクトが無ければ供給元を呼ばずに空の結果を返す', async () => {
    const { sources, calls } = sourcesOf([
      { key: 'comments', metrics: valuesOf([]) },
    ]);
    const reader = new SourcedItemMetricsReader(sources);

    const metrics = await reader.read([], AT);

    expect(calls).toStrictEqual([]);
    expect(metrics.size).toBe(0);
  });

  test('一覧の1ページの件数を超えるプロダクトは、供給元を呼ばずに拒否する', async () => {
    const { sources, calls } = sourcesOf([
      { key: 'comments', metrics: valuesOf([]) },
    ]);
    const reader = new SourcedItemMetricsReader(sources);
    const productIds = Array.from(
      { length: DIRECTORY_PAGE_SIZE + 1 },
      (_, index) => `01JD0PROD${String(index).padStart(17, '0')}`,
    );

    let rejection: unknown;

    try {
      await reader.read(productIds, AT);
    } catch (error: unknown) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(RangeError);
    expect(calls).toStrictEqual([]);
  });
});
