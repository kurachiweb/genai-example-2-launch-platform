import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import { LifecycleRegistrationError } from '../../../lib/core/identity/user-lifecycle.ts';
import {
  assertDecisionSourceRegistrations,
  callDecisionSources,
  type DecisionSourceRegistration,
  type LaunchSummaryContribution,
  type LaunchSummarySource,
  pickLaunchSummaries,
  type ProductLockSource,
  type RegisteredDecisionSource,
  type RelaunchConditionSource,
  resolveDecisionSources,
} from './decision-sources.ts';

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

const registration = (
  name: string,
  order: number,
): DecisionSourceRegistration<unknown> => ({
  name,
  order,
  source: Symbol.for(`test.${name}`),
});

describe('assertDecisionSourceRegistrations', () => {
  test('空の登録と、形式どおりで重複の無い登録を受け付ける', () => {
    expect(() => {
      assertDecisionSourceRegistrations([]);
    }).not.toThrow();
    expect(() => {
      assertDecisionSourceRegistrations([
        registration('tournament-week.result-pending', 10),
        registration('tournament-year.result-pending', 20),
      ]);
    }).not.toThrow();
  });

  test.each([
    'tournament-week',
    'Tournament-week.result-pending',
    'tournament-week.result_pending',
    'tournament-week.',
    '.result-pending',
    'tournament-week.result-pending.extra',
  ])('名前%pは<spec名>.<名詞句>の形でないため拒否する', (name) => {
    expect(() => {
      assertDecisionSourceRegistrations([registration(name, 10)]);
    }).toThrow(LifecycleRegistrationError);
  });

  test('同じ名前の登録を拒否する', () => {
    expect(() => {
      assertDecisionSourceRegistrations([
        registration('tournament-week.result-pending', 10),
        registration('tournament-week.result-pending', 20),
      ]);
    }).toThrow('判定の供給元の名前が重複しています');
  });

  test('同じorderの登録を拒否する', () => {
    expect(() => {
      assertDecisionSourceRegistrations([
        registration('tournament-week.result-pending', 10),
        registration('tournament-year.result-pending', 10),
      ]);
    }).toThrow('orderが重複しています');
  });

  test.each([1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'orderが整数でない%pの登録を拒否する',
    (order) => {
      expect(() => {
        assertDecisionSourceRegistrations([
          registration('tournament-week.result-pending', order),
        ]);
      }).toThrow('orderは整数で指定してください');
    },
  );
});

describe('resolveDecisionSources', () => {
  test('登録の識別子を解決し、orderの小さい順に名前と供給元を並べる', () => {
    const registrations = [
      registration('tournament-year.result-pending', 20),
      registration('tournament-week.result-pending', 10),
    ];
    const resolved = resolveDecisionSources(
      registrations,
      (identifier) => `instance:${String(identifier)}`,
    );

    expect(resolved).toStrictEqual([
      {
        name: 'tournament-week.result-pending',
        source: 'instance:Symbol(test.tournament-week.result-pending)',
      },
      {
        name: 'tournament-year.result-pending',
        source: 'instance:Symbol(test.tournament-year.result-pending)',
      },
    ]);
    expect(registrations[0]?.order).toBe(20);
  });

  test('登録が規則に反していれば、識別子を解決せずに拒否する', () => {
    const resolved: unknown[] = [];

    expect(() =>
      resolveDecisionSources([registration('invalid', 10)], (identifier) =>
        resolved.push(identifier),
      ),
    ).toThrow(LifecycleRegistrationError);
    expect(resolved).toStrictEqual([]);
  });
});

describe('callDecisionSources', () => {
  const AT = new Date('2026-09-10T01:00:00.000Z');

  test('3種類の供給元を、それぞれ登録の順に1回ずつ呼び、結果を登録の順に返す', async () => {
    const calls: string[] = [];
    const relaunch = (
      name: string,
    ): RegisteredDecisionSource<RelaunchConditionSource> => ({
      name,
      source: {
        findBlocks: () => {
          calls.push(`blocks:${name}`);
          return Promise.resolve([]);
        },
      },
    });
    const lock = (
      name: string,
    ): RegisteredDecisionSource<ProductLockSource> => ({
      name,
      source: {
        findLocks: () => {
          calls.push(`locks:${name}`);
          return Promise.resolve([]);
        },
      },
    });
    const summary = (
      name: string,
    ): RegisteredDecisionSource<LaunchSummarySource> => ({
      name,
      source: {
        summarize: () => {
          calls.push(`summary:${name}`);
          return Promise.resolve({
            launches: [
              { launchId: name, label: name, inMatch: false, rank: 1 },
            ],
            awards: [],
          });
        },
      },
    });

    const blocks = await callDecisionSources(
      [relaunch('a.first'), relaunch('a.second')],
      (source) => source.findBlocks({ subjects: [], at: AT }),
    );
    const locks = await callDecisionSources(
      [lock('b.first'), lock('b.second')],
      (source) => source.findLocks({ subjects: [], at: AT }),
    );
    const summaries = await callDecisionSources(
      [summary('c.first'), summary('c.second')],
      (source) => source.summarize({ launches: [], at: AT }),
    );

    expect(calls).toStrictEqual([
      'blocks:a.first',
      'blocks:a.second',
      'locks:b.first',
      'locks:b.second',
      'summary:c.first',
      'summary:c.second',
    ]);
    expect(blocks).toStrictEqual({ failed: false, results: [[], []] });
    expect(locks.failed).toBe(false);
    expect(
      summaries.results.map(({ launches }) => launches[0]?.launchId),
    ).toStrictEqual(['c.first', 'c.second']);
    expect(records).toStrictEqual([]);
  });

  test('登録が無ければ何も呼ばず、失敗の無い空の結果を返す', async () => {
    expect(
      await callDecisionSources<RelaunchConditionSource, unknown>([], () =>
        Promise.reject(new Error('呼ばれない')),
      ),
    ).toStrictEqual({ failed: false, results: [] });
  });

  test('例外を投げた供給元を除いた結果と失敗を返し、警告のログに供給元の名前だけを残す', async () => {
    const secret = new Error('利用者のメールアドレスを含む失敗の詳細');
    const sources: RegisteredDecisionSource<() => Promise<string>>[] = [
      { name: 'a.first', source: () => Promise.resolve('first') },
      {
        name: 'a.broken',
        source: () => {
          throw secret;
        },
      },
      { name: 'a.last', source: () => Promise.resolve('last') },
    ];

    const outcome = await callDecisionSources(sources, (source) => source());

    expect(outcome).toStrictEqual({ failed: true, results: ['first', 'last'] });
    expect(records).toHaveLength(1);
    expect(records[0]?.level).toBe('warning');
    expect(records[0]?.category).toStrictEqual([
      'api',
      'application',
      'product',
    ]);
    expect(records[0]?.properties).toStrictEqual({ sourceName: 'a.broken' });
  });
});

describe('pickLaunchSummaries', () => {
  const contribution = (
    launchId: string,
    label: string,
    rank: number,
  ): LaunchSummaryContribution => ({ launchId, label, inMatch: false, rank });

  test('ローンチごとにrankの大きい要約を採り、同じrankなら先に受け取った要約を残す', () => {
    const picked = pickLaunchSummaries([
      contribution('l-1', '週間2位', 1),
      contribution('l-1', '週間1位', 2),
      contribution('l-1', '週間1位(後)', 2),
      contribution('l-2', '年間1位', 5),
      contribution('l-2', '週間3位', 1),
    ]);

    expect([...picked]).toStrictEqual([
      ['l-1', contribution('l-1', '週間1位', 2)],
      ['l-2', contribution('l-2', '年間1位', 5)],
    ]);
  });

  test('要約が無ければ空のMapを返す', () => {
    expect(pickLaunchSummaries([]).size).toBe(0);
  });
});
