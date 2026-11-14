import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';
import type { ServiceIdentifier } from 'inversify';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'vitest';

import { MATCH_RESULT_SUPPLEMENT_LIMIT } from '../../../lib/core/email/kinds/notifications.ts';
import type { MatchKind } from '../../../lib/core/match/match-model.ts';
import {
  createResultNoticeSupplementRegistry,
  type ResultNoticeSupplement,
  type ResultNoticeSupplementInput,
  type ResultNoticeSupplementProvider,
  type ResultNoticeSupplementRegistration,
} from '../../../lib/core/notifications/result-notice-supplements.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import type { SupplementSource } from '../../application/notifications/ports.ts';
import { RegisteredSupplementSource } from './registered-supplement-source.ts';

const records: LogRecord[] = [];

beforeAll(() => {
  configureSync({
    reset: true,
    sinks: { capture: (record) => records.push(record) },
    loggers: [
      { category: ['event'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterAll(() => {
  resetSync();
});

beforeEach(() => {
  records.length = 0;
});

function supplementLogs(): LogRecord[] {
  return records.filter(
    (record) => record.category.join('.') === 'event.notifications.supplements',
  );
}

function input(
  kind: MatchKind,
  overrides: Partial<ResultNoticeSupplementInput> = {},
): ResultNoticeSupplementInput {
  return {
    matchId: `match-${kind}`,
    kind,
    round: kind === 'qualifier' ? null : 1,
    stage: null,
    matchDate: parseBusinessDate('2026-11-20'),
    entryId: `entry-${kind}`,
    launchId: null,
    productId: `product-${kind}`,
    ownerUserId: 'user-1',
    result: 'won',
    decidedAt: new Date('2026-11-21T06:00:00.000Z'),
    ...overrides,
  };
}

function supplement(title: string): ResultNoticeSupplement {
  return {
    title,
    lines: [`${title}の行`],
    emphasized: false,
  };
}

interface FakeProvider {
  readonly identifier: symbol;
  readonly provider: ResultNoticeSupplementProvider;
}

function createHarness(
  entries: readonly {
    readonly name: string;
    readonly kinds: readonly MatchKind[];
    readonly order: number;
    readonly supplementFor: ResultNoticeSupplementProvider['supplementFor'];
  }[],
): {
  readonly source: SupplementSource;
  readonly calls: { readonly name: string; readonly input: unknown }[];
} {
  const calls: { readonly name: string; readonly input: unknown }[] = [];
  const providers = new Map<
    ServiceIdentifier<ResultNoticeSupplementProvider>,
    FakeProvider['provider']
  >();
  const registrations: ResultNoticeSupplementRegistration[] = entries.map(
    ({ name, kinds, order, supplementFor }) => {
      const identifier = Symbol.for(`test.${name}`);
      providers.set(identifier, {
        supplementFor: (value) => {
          calls.push({ name, input: value });
          return supplementFor(value);
        },
      });
      return { name, kinds, order, provider: identifier };
    },
  );
  const source = new RegisteredSupplementSource(
    createResultNoticeSupplementRegistry(registrations),
    (identifier) => {
      const provider = providers.get(identifier);
      if (provider === undefined) {
        throw new Error(`未登録の提供元: ${String(identifier)}`);
      }
      return provider;
    },
  );
  return { source, calls };
}

const returning =
  (value: unknown): ResultNoticeSupplementProvider['supplementFor'] =>
  () =>
    Promise.resolve(value as ResultNoticeSupplement | undefined);

describe('登録された結果の追記の取得', () => {
  test('登録が無ければ、どの通知にも追記の無い空の対応表を返す', async () => {
    const { source } = createHarness([]);

    const supplements = await source.supplementsFor([
      { noticeId: 'notice-1', input: input('qualifier') },
      { noticeId: 'notice-2', input: input('week') },
    ]);

    expect(supplements.size).toBe(0);
  });

  test('マッチの種別に登録された提供元だけを、orderの昇順に呼び、受け取った入力をそのまま渡す', async () => {
    const { source, calls } = createHarness([
      {
        name: 'supplement-test.week-only',
        kinds: ['week'],
        order: 150,
        supplementFor: returning(supplement('Weekだけ')),
      },
      {
        name: 'supplement-test.second',
        kinds: ['qualifier', 'week'],
        order: 200,
        supplementFor: returning(supplement('2つ目')),
      },
      {
        name: 'supplement-test.first',
        kinds: ['qualifier'],
        order: 100,
        supplementFor: returning(supplement('1つ目')),
      },
    ]);
    const qualifier = input('qualifier');
    const week = input('week');

    const supplements = await source.supplementsFor([
      { noticeId: 'notice-qualifier', input: qualifier },
      { noticeId: 'notice-week', input: week },
      { noticeId: 'notice-year', input: input('year') },
    ]);

    expect(calls).toStrictEqual([
      { name: 'supplement-test.first', input: qualifier },
      { name: 'supplement-test.second', input: qualifier },
      { name: 'supplement-test.week-only', input: week },
      { name: 'supplement-test.second', input: week },
    ]);
    expect(calls[0]?.input).toBe(qualifier);
    expect(supplements).toStrictEqual(
      new Map([
        ['notice-qualifier', [supplement('1つ目'), supplement('2つ目')]],
        ['notice-week', [supplement('Weekだけ'), supplement('2つ目')]],
      ]),
    );
    expect(supplements.has('notice-year')).toBe(false);
  });

  test('追記は通知ごとに3件までで、3件が揃った後の提供元は呼ばない', async () => {
    const { source, calls } = createHarness(
      [100, 200, 300, 400, 500].map((order) => ({
        name: `supplement-test.order${String(order)}`,
        kinds: ['qualifier'],
        order,
        supplementFor:
          order === 100
            ? returning(undefined)
            : returning(supplement(`順${String(order)}`)),
      })),
    );

    const supplements = await source.supplementsFor([
      { noticeId: 'notice-1', input: input('qualifier') },
    ]);

    expect(MATCH_RESULT_SUPPLEMENT_LIMIT).toBe(3);
    expect(supplements.get('notice-1')).toStrictEqual([
      supplement('順200'),
      supplement('順300'),
      supplement('順400'),
    ]);
    expect(calls.map(({ name }) => name)).toStrictEqual([
      'supplement-test.order100',
      'supplement-test.order200',
      'supplement-test.order300',
      'supplement-test.order400',
    ]);
  });

  test('形式に合わない追記は捨てて、提供元の名前だけを警告のログに出し、後の提供元の追記は残す', async () => {
    const secret = '秘密の見出しの内容';
    const { source } = createHarness([
      {
        name: 'supplement-test.malformed',
        kinds: ['qualifier'],
        order: 100,
        supplementFor: returning({
          title: secret,
          lines: [],
          emphasized: false,
        }),
      },
      {
        name: 'supplement-test.not-object',
        kinds: ['qualifier'],
        order: 200,
        supplementFor: returning(null),
      },
      {
        name: 'supplement-test.valid',
        kinds: ['qualifier'],
        order: 300,
        supplementFor: returning(supplement('正しい追記')),
      },
    ]);

    const supplements = await source.supplementsFor([
      { noticeId: 'notice-1', input: input('qualifier') },
    ]);

    expect(supplements).toStrictEqual(
      new Map([['notice-1', [supplement('正しい追記')]]]),
    );
    const logs = supplementLogs();
    expect(
      logs.map(({ level, properties }) => ({ level, properties })),
    ).toStrictEqual([
      {
        level: 'warning',
        properties: { provider: 'supplement-test.malformed' },
      },
      {
        level: 'warning',
        properties: { provider: 'supplement-test.not-object' },
      },
    ]);
    expect(JSON.stringify(logs.map(({ message }) => message))).not.toContain(
      secret,
    );
  });

  test('形式に合う追記は契約の項目だけにして返す', async () => {
    const { source } = createHarness([
      {
        name: 'supplement-test.extra',
        kinds: ['qualifier'],
        order: 100,
        supplementFor: returning({
          ...supplement('余分な項目'),
          internal: 'payment-intent',
        }),
      },
    ]);

    const supplements = await source.supplementsFor([
      { noticeId: 'notice-1', input: input('qualifier') },
    ]);

    expect(supplements.get('notice-1')).toStrictEqual([
      supplement('余分な項目'),
    ]);
  });

  test('提供元の例外は捕まえずにそのまま投げる', async () => {
    const failure = new Error('決済期限を読めません');
    const { source, calls } = createHarness([
      {
        name: 'supplement-test.failing',
        kinds: ['qualifier'],
        order: 100,
        supplementFor: () => Promise.reject(failure),
      },
      {
        name: 'supplement-test.after',
        kinds: ['qualifier'],
        order: 200,
        supplementFor: returning(supplement('後の追記')),
      },
    ]);

    await expect(
      source.supplementsFor([
        { noticeId: 'notice-1', input: input('qualifier') },
      ]),
    ).rejects.toBe(failure);
    expect(calls.map(({ name }) => name)).toStrictEqual([
      'supplement-test.failing',
    ]);
  });
});
