import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';
import type { ServiceIdentifier } from 'inversify';

import type {
  LaunchStatus,
  QualifierOutcome,
} from '../../../lib/core/product/launch-status.ts';
import type { LaunchRecord } from '../../../lib/core/product/ports.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import {
  type LaunchSummarySource,
  type RegisteredDecisionSource,
  resolveDecisionSources,
} from '../product/decision-sources.ts';
import { SourcedLaunchHighlightsReader } from './launch-highlights-reader.ts';

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

const launchOf = (
  launchId: string,
  productId: string,
  status: LaunchStatus,
  outcome: QualifierOutcome | null = null,
): LaunchRecord => ({
  launchId,
  productId,
  number: 1,
  launchDate: parseBusinessDate('2026-11-05'),
  status,
  outcome,
  decidedAt: outcome === null ? null : AT,
});

type SummaryResult = Awaited<ReturnType<LaunchSummarySource['summarize']>>;

type SummarizeInput = Parameters<LaunchSummarySource['summarize']>[0];

interface SourceSpec {
  readonly name: string;
  readonly order: number;
  readonly summarize: () => Promise<SummaryResult>;
}

// 登録口と同じくresolveDecisionSourcesを通し、orderの順に並べた一覧を作る
function sourcesOf(specs: readonly SourceSpec[]) {
  const calls: { readonly name: string; readonly input: SummarizeInput }[] = [];
  const byIdentifier = new Map<ServiceIdentifier, LaunchSummarySource>(
    specs.map(({ name, summarize }) => [
      Symbol.for(`test.${name}`),
      {
        summarize: (input) => {
          calls.push({ name, input });
          return summarize();
        },
      },
    ]),
  );
  const sources: readonly RegisteredDecisionSource<LaunchSummarySource>[] =
    resolveDecisionSources(
      specs.map(({ name, order }) => ({
        name,
        order,
        source: Symbol.for(`test.${name}`),
      })),
      (identifier) => {
        const source = byIdentifier.get(identifier);
        if (source === undefined) {
          throw new Error('未登録の識別子');
        }
        return source;
      },
    );
  return { sources, calls };
}

const resultOf = (
  result: Partial<SummaryResult> = {},
): (() => Promise<SummaryResult>) => {
  return () => Promise.resolve({ launches: [], awards: [], ...result });
};

describe('LaunchHighlightsReader.read: ローンチの要約', () => {
  test('供給元をorderの順に1回ずつ、全てのローンチと判定の時刻を渡して呼ぶ', async () => {
    const { sources, calls } = sourcesOf([
      { name: 'spec-test.year', order: 20, summarize: resultOf() },
      { name: 'spec-test.week', order: 10, summarize: resultOf() },
    ]);
    const reader = new SourcedLaunchHighlightsReader(sources);

    await reader.read({
      launches: [
        launchOf('l-1', PRODUCT_A, 'finished', 'won'),
        launchOf('l-2', PRODUCT_B, 'in_progress'),
      ],
      at: AT,
    });

    expect(calls.map(({ name }) => name)).toStrictEqual([
      'spec-test.week',
      'spec-test.year',
    ]);
    for (const { input } of calls) {
      expect(input).toStrictEqual({
        launches: [
          { launchId: 'l-1', productId: PRODUCT_A, outcome: 'won' },
          { launchId: 'l-2', productId: PRODUCT_B, outcome: null },
        ],
        at: AT,
      });
    }
  });

  test('同じローンチに複数の供給元が要約を返したら、rankの大きい要約を採る', async () => {
    const { sources } = sourcesOf([
      {
        name: 'spec-test.week',
        order: 10,
        summarize: resultOf({
          launches: [
            { launchId: 'l-1', label: '週間1位', inMatch: false, rank: 1 },
            { launchId: 'l-2', label: 'Week 準決勝', inMatch: true, rank: 3 },
          ],
        }),
      },
      {
        name: 'spec-test.year',
        order: 20,
        summarize: resultOf({
          launches: [
            { launchId: 'l-1', label: '年間1位', inMatch: false, rank: 2 },
            { launchId: 'l-2', label: '年間出場', inMatch: false, rank: 1 },
          ],
        }),
      },
    ]);
    const reader = new SourcedLaunchHighlightsReader(sources);

    const { summaries } = await reader.read({
      launches: [
        launchOf('l-1', PRODUCT_A, 'finished', 'won'),
        launchOf('l-2', PRODUCT_B, 'finished', 'won'),
      ],
      at: AT,
    });

    expect([...summaries]).toStrictEqual([
      ['l-1', { label: '年間1位', inMatch: false }],
      ['l-2', { label: 'Week 準決勝', inMatch: true }],
    ]);
  });

  test('供給の無いローンチは予選の結果から要約を作り、渡していないローンチの要約は捨てる', async () => {
    const { sources } = sourcesOf([
      {
        name: 'spec-test.week',
        order: 10,
        summarize: resultOf({
          launches: [
            { launchId: 'l-1', label: '週間1位', inMatch: false, rank: 1 },
            { launchId: 'l-x', label: '週間2位', inMatch: false, rank: 1 },
          ],
        }),
      },
    ]);
    const reader = new SourcedLaunchHighlightsReader(sources);

    const { summaries } = await reader.read({
      launches: [
        launchOf('l-1', PRODUCT_A, 'finished', 'won'),
        launchOf('l-2', PRODUCT_A, 'finished', 'lost'),
        launchOf('l-3', PRODUCT_B, 'in_progress'),
        launchOf('l-4', PRODUCT_B, 'scheduled'),
      ],
      at: AT,
    });

    expect([...summaries]).toStrictEqual([
      ['l-1', { label: '週間1位', inMatch: false }],
      ['l-2', { label: '予選敗北', inMatch: false }],
      ['l-3', { label: '予選マッチ中', inMatch: true }],
      ['l-4', { label: 'キックオフ予定', inMatch: false }],
    ]);
    expect(records).toStrictEqual([]);
  });

  test('供給元が登録されていなければ呼ばずに、全てのローンチを予選の結果から要約する', async () => {
    const reader = new SourcedLaunchHighlightsReader([]);

    const { summaries, awards } = await reader.read({
      launches: [launchOf('l-1', PRODUCT_A, 'finished', 'won')],
      at: AT,
    });

    expect([...summaries]).toStrictEqual([
      ['l-1', { label: 'ディレクトリ掲載', inMatch: false }],
    ]);
    expect([...awards]).toStrictEqual([[PRODUCT_A, []]]);
  });

  test('供給元の失敗は警告のログに名前だけを残してその供給元を除き、残りの要約と予選の結果の要約で示す', async () => {
    const { sources, calls } = sourcesOf([
      {
        name: 'spec-test.failing',
        order: 10,
        summarize: () =>
          Promise.reject(new Error('利用者のメールアドレスを含む失敗の詳細')),
      },
      {
        name: 'spec-test.partial',
        order: 20,
        summarize: resultOf({
          launches: [
            { launchId: 'l-2', label: '週間1位', inMatch: false, rank: 1 },
          ],
        }),
      },
    ]);
    const reader = new SourcedLaunchHighlightsReader(sources);

    const { summaries } = await reader.read({
      launches: [
        launchOf('l-1', PRODUCT_A, 'finished', 'won'),
        launchOf('l-2', PRODUCT_B, 'finished', 'won'),
      ],
      at: AT,
    });

    expect(calls).toHaveLength(2);
    expect([...summaries]).toStrictEqual([
      ['l-1', { label: 'ディレクトリ掲載', inMatch: false }],
      ['l-2', { label: '週間1位', inMatch: false }],
    ]);
    const warnings = records.filter(({ level }) => level === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.properties).toStrictEqual({
      sourceName: 'spec-test.failing',
    });
  });

  test('全ての供給元が失敗しても、予選の結果の要約で一覧を返す', async () => {
    const { sources } = sourcesOf([
      {
        name: 'spec-test.failing',
        order: 10,
        summarize: () => Promise.reject(new Error('失敗')),
      },
    ]);
    const reader = new SourcedLaunchHighlightsReader(sources);

    const { summaries, awards } = await reader.read({
      launches: [launchOf('l-1', PRODUCT_A, 'finished', 'lost')],
      at: AT,
    });

    expect([...summaries]).toStrictEqual([
      ['l-1', { label: '予選敗北', inMatch: false }],
    ]);
    expect([...awards]).toStrictEqual([[PRODUCT_A, []]]);
  });

  test('ローンチが無ければ供給元を呼ばずに空の結果を返す', async () => {
    const { sources, calls } = sourcesOf([
      { name: 'spec-test.week', order: 10, summarize: resultOf() },
    ]);
    const reader = new SourcedLaunchHighlightsReader(sources);

    const { summaries, awards } = await reader.read({ launches: [], at: AT });

    expect(calls).toStrictEqual([]);
    expect(summaries.size).toBe(0);
    expect(awards.size).toBe(0);
  });
});

describe('LaunchHighlightsReader.read: 受賞', () => {
  test('受賞をプロダクトごとに種類でまとめ、Yearを先頭にラベルを受け取った順に並べる', async () => {
    const { sources } = sourcesOf([
      {
        name: 'spec-test.week',
        order: 10,
        summarize: resultOf({
          awards: [
            { productId: PRODUCT_A, kind: 'week', label: '2026年第45週' },
            { productId: PRODUCT_A, kind: 'week', label: '2026年第40週' },
          ],
        }),
      },
      {
        name: 'spec-test.year',
        order: 20,
        summarize: resultOf({
          awards: [{ productId: PRODUCT_A, kind: 'year', label: '2025年' }],
        }),
      },
    ]);
    const reader = new SourcedLaunchHighlightsReader(sources);

    const { awards } = await reader.read({
      launches: [
        launchOf('l-1', PRODUCT_A, 'finished', 'won'),
        launchOf('l-2', PRODUCT_A, 'finished', 'won'),
        launchOf('l-3', PRODUCT_B, 'finished', 'won'),
      ],
      at: AT,
    });

    expect([...awards]).toStrictEqual([
      [
        PRODUCT_A,
        [
          { kind: 'year', count: 1, labels: ['2025年'] },
          { kind: 'week', count: 2, labels: ['2026年第45週', '2026年第40週'] },
        ],
      ],
      [PRODUCT_B, []],
    ]);
  });

  test('渡したローンチのプロダクトに無い受賞は捨てる', async () => {
    const { sources } = sourcesOf([
      {
        name: 'spec-test.week',
        order: 10,
        summarize: resultOf({
          awards: [
            { productId: PRODUCT_OUTSIDE, kind: 'week', label: '2026年第45週' },
          ],
        }),
      },
    ]);
    const reader = new SourcedLaunchHighlightsReader(sources);

    const { awards } = await reader.read({
      launches: [launchOf('l-1', PRODUCT_A, 'finished', 'won')],
      at: AT,
    });

    expect([...awards]).toStrictEqual([[PRODUCT_A, []]]);
  });
});
