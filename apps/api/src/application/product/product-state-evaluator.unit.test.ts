import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type { LaunchStatus } from '../../../lib/core/product/launch-status.ts';
import type { LaunchRecord } from '../../../lib/core/product/ports.ts';
import {
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import type { UltrasEntitlements } from '../../../lib/core/ultras/ports.ts';
import { LAUNCH_PLAN_MESSAGES } from '../../domain/product/launch-plan.ts';
import type {
  DecisionSubject,
  ProductLockEntry,
  ProductLockSource,
  RegisteredDecisionSource,
  RelaunchBlock,
  RelaunchConditionSource,
} from './decision-sources.ts';
import {
  DefaultProductStateEvaluator,
  PRODUCT_STATE_BATCH_MAX,
  type ProductStateInput,
} from './product-state-evaluator.ts';

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

const day = (value: string): BusinessDate => parseBusinessDate(value);

const at = (date: string, hour: number, minute: number): Date =>
  fromBusinessDateTime(day(date), { hour, minute });

const AT = at('2026-09-07', 23, 0);
const OWNER_ID = '01JC0USER00000000000000001';

const launch = (
  launchId: string,
  productId: string,
  launchDate: string,
  status: LaunchStatus,
  outcome: LaunchRecord['outcome'] = null,
): LaunchRecord => ({
  launchId,
  productId,
  number: status === 'canceled' ? 0 : 1,
  launchDate: day(launchDate),
  status,
  outcome,
  decidedAt: outcome === null ? null : at(launchDate, 23, 50),
});

const product = (
  productId: string,
  launches: readonly LaunchRecord[],
  hidden = false,
): ProductStateInput => ({ productId, hidden, launches });

const lostProduct = product('p-lost', [
  launch('l-lost', 'p-lost', '2026-09-07', 'finished', 'lost'),
]);
const wonProduct = product('p-won', [
  launch('l-won', 'p-won', '2026-09-07', 'finished', 'won'),
]);
const scheduledProduct = product('p-scheduled', [
  launch('l-cancelled', 'p-scheduled', '2026-09-25', 'canceled'),
  launch('l-scheduled', 'p-scheduled', '2026-09-20', 'scheduled'),
  launch('l-previous', 'p-scheduled', '2026-09-07', 'finished', 'lost'),
]);
const inMatchProduct = product('p-in-match', [
  launch('l-in-match', 'p-in-match', '2026-09-07', 'in_progress'),
]);
const freshProduct = product('p-fresh', []);

interface SetupOptions {
  readonly blocks?: readonly (readonly RelaunchBlock[] | Error)[];
  readonly locks?: readonly (readonly ProductLockEntry[] | Error)[];
  readonly entitled?: boolean | Error;
}

function setup(options: SetupOptions = {}) {
  const calls: string[] = [];
  const subjectsSeen: (readonly DecisionSubject[])[] = [];
  const entitlementCalls: [string, Date][] = [];
  const relaunchSources: RegisteredDecisionSource<RelaunchConditionSource>[] = (
    options.blocks ?? [[]]
  ).map((result, index) => ({
    name: `relaunch-spec.condition-${String(index)}`,
    source: {
      findBlocks: (input) => {
        calls.push(`blocks:${String(index)}`);
        subjectsSeen.push(input.subjects);
        expect(input.at).toBe(AT);
        if (result instanceof Error) {
          return Promise.reject(result);
        }
        return Promise.resolve(result);
      },
    },
  }));
  const lockSources: RegisteredDecisionSource<ProductLockSource>[] = (
    options.locks ?? [[]]
  ).map((result, index) => ({
    name: `lock-spec.condition-${String(index)}`,
    source: {
      findLocks: (input) => {
        calls.push(`locks:${String(index)}`);
        subjectsSeen.push(input.subjects);
        expect(input.at).toBe(AT);
        if (result instanceof Error) {
          return Promise.reject(result);
        }
        return Promise.resolve(result);
      },
    },
  }));
  const entitlements: Pick<UltrasEntitlements, 'isEntitledAt'> = {
    isEntitledAt: (userId, time) => {
      entitlementCalls.push([userId, time]);
      const entitled = options.entitled ?? false;
      if (entitled instanceof Error) {
        return Promise.reject(entitled);
      }
      return Promise.resolve(entitled);
    },
  };
  const evaluator = new DefaultProductStateEvaluator(
    relaunchSources,
    lockSources,
    entitlements as UltrasEntitlements,
  );
  const evaluate = (products: readonly ProductStateInput[]) =>
    evaluator.evaluate({ ownerUserId: OWNER_ID, products, at: AT });
  return { calls, subjectsSeen, entitlementCalls, evaluate };
}

const stateOf = async (
  promise: Promise<ReadonlyMap<string, unknown>>,
  productId: string,
) => (await promise).get(productId);

describe('DefaultProductStateEvaluator', () => {
  test('2種類の供給元を、プロダクトの一覧につき登録の順に1回ずつ、取消を除く直近のローンチを添えて呼ぶ', async () => {
    const { calls, subjectsSeen, evaluate } = setup({
      blocks: [[], []],
      locks: [[], []],
    });

    const states = await evaluate([scheduledProduct, freshProduct]);

    expect(calls.filter((call) => call.startsWith('blocks'))).toStrictEqual([
      'blocks:0',
      'blocks:1',
    ]);
    expect(calls.filter((call) => call.startsWith('locks'))).toStrictEqual([
      'locks:0',
      'locks:1',
    ]);
    const expectedSubjects: readonly DecisionSubject[] = [
      {
        productId: 'p-scheduled',
        ownerUserId: OWNER_ID,
        latestLaunch: {
          launchId: 'l-scheduled',
          launchDate: day('2026-09-20'),
          status: 'scheduled',
          outcome: null,
        },
      },
      { productId: 'p-fresh', ownerUserId: OWNER_ID, latestLaunch: null },
    ];
    for (const subjects of subjectsSeen) {
      expect(subjects).toStrictEqual(expectedSubjects);
    }
    expect([...states.keys()]).toStrictEqual(['p-scheduled', 'p-fresh']);
    expect(states.get('p-scheduled')?.latestLaunch?.launchId).toBe(
      'l-scheduled',
    );
    expect(states.get('p-fresh')?.latestLaunch).toBeNull();
  });

  test('該当した次回の予約の禁止の理由と解除の日時、固定の理由をそのプロダクトの計画に入れる', async () => {
    const releaseAt = at('2026-09-14', 23, 35);
    const { evaluate } = setup({
      blocks: [
        [
          {
            productId: 'p-won',
            code: 'tournament-week.result-pending',
            message:
              'Weekトーナメントの結果が確定するまで再ローンチできません。',
            releaseAt,
          },
          {
            productId: 'p-unknown',
            code: 'tournament-week.result-pending',
            message: '対象外のプロダクト',
            releaseAt: null,
          },
        ],
        [
          {
            productId: 'p-won',
            code: 'tournament-year.result-pending',
            message:
              'Yearトーナメントの結果が確定するまで再ローンチできません。',
            releaseAt: null,
          },
        ],
      ],
      locks: [
        [
          {
            productId: 'p-in-match',
            code: 'tournament-week.match-lock',
            message: 'トーナメントのマッチ中のため変更できません。',
          },
          {
            productId: 'p-won',
            code: 'tournament-week.match-lock',
            message: 'トーナメントのマッチ中のため変更できません。',
          },
        ],
      ],
    });

    const states = await evaluate([wonProduct, inMatchProduct, freshProduct]);

    expect(states.get('p-won')?.plan).toStrictEqual({
      mode: 'blocked',
      blocks: [
        {
          code: 'tournament-week.result-pending',
          message: 'Weekトーナメントの結果が確定するまで再ローンチできません。',
          releaseAt,
        },
        {
          code: 'tournament-year.result-pending',
          message: 'Yearトーナメントの結果が確定するまで再ローンチできません。',
          releaseAt: null,
        },
      ],
    });
    expect(states.get('p-won')?.window).toBeNull();
    expect(states.get('p-won')?.locks).toStrictEqual({
      locked: true,
      locks: [
        {
          code: 'tournament-week.match-lock',
          message: 'トーナメントのマッチ中のため変更できません。',
        },
      ],
      unknown: false,
    });
    expect(states.get('p-in-match')?.locks).toStrictEqual({
      locked: true,
      locks: [
        {
          code: 'qualifier_match',
          message: LAUNCH_PLAN_MESSAGES.qualifier_match,
        },
        {
          code: 'tournament-week.match-lock',
          message: 'トーナメントのマッチ中のため変更できません。',
        },
      ],
      unknown: false,
    });
    expect(states.get('p-fresh')?.plan).toStrictEqual({
      mode: 'new',
      basis: null,
    });
    expect(states.get('p-fresh')?.locks).toStrictEqual({
      locked: false,
      locks: [],
      unknown: false,
    });
    expect(states.has('p-unknown')).toBe(false);
  });

  test('次回の予約の禁止の供給元の例外は、その種類を確認できない状態にし、警告のログに供給元の名前だけを残す', async () => {
    const { evaluate } = setup({
      blocks: [[], new Error('秘密の詳細')],
      locks: [[]],
    });

    const states = await evaluate([wonProduct, scheduledProduct]);

    expect(states.get('p-won')?.plan).toStrictEqual({ mode: 'unknown' });
    expect(states.get('p-won')?.window).toBeNull();
    expect(states.get('p-won')?.locks.unknown).toBe(false);
    expect(states.get('p-scheduled')?.plan.mode).toBe('reschedule');
    expect(records).toHaveLength(1);
    expect(records[0]?.level).toBe('warning');
    expect(records[0]?.properties).toStrictEqual({
      sourceName: 'relaunch-spec.condition-1',
    });
  });

  test('固定の供給元の例外は、固定を確認できない状態にし、本specの固定と次回の予約の計画は残す', async () => {
    const { evaluate } = setup({
      blocks: [[]],
      locks: [new Error('秘密の詳細')],
    });

    const states = await evaluate([inMatchProduct, wonProduct]);

    expect(states.get('p-in-match')?.locks).toStrictEqual({
      locked: true,
      locks: [
        {
          code: 'qualifier_match',
          message: LAUNCH_PLAN_MESSAGES.qualifier_match,
        },
      ],
      unknown: true,
    });
    expect(states.get('p-won')?.locks.unknown).toBe(true);
    expect(states.get('p-won')?.plan).toStrictEqual({
      mode: 'new',
      basis: { launchDate: day('2026-09-07'), outcome: 'won' },
    });
    expect(records.map(({ properties }) => properties)).toStrictEqual([
      { sourceName: 'lock-spec.condition-0' },
    ]);
  });

  test('敗北が基準のプロダクトがあるときだけ、Ultrasの判定を一覧につき1回、判定の時点で呼ぶ', async () => {
    const withLost = setup();
    await withLost.evaluate([lostProduct, scheduledProduct, wonProduct]);

    expect(withLost.entitlementCalls).toStrictEqual([[OWNER_ID, AT]]);

    const withoutLost = setup();
    await withoutLost.evaluate([wonProduct, freshProduct, inMatchProduct]);

    expect(withoutLost.entitlementCalls).toStrictEqual([]);
  });

  test('直近が敗北でも次回の予約が禁止されていれば、Ultrasの判定を呼ばない', async () => {
    const { entitlementCalls, evaluate } = setup({
      blocks: [
        [
          {
            productId: 'p-lost',
            code: 'tournament-week.result-pending',
            message: '再ローンチできません。',
            releaseAt: null,
          },
        ],
      ],
    });

    const states = await evaluate([lostProduct]);

    expect(states.get('p-lost')?.plan.mode).toBe('blocked');
    expect(entitlementCalls).toStrictEqual([]);
    expect(states.get('p-lost')?.ultrasEntitled).toBe(false);
  });

  test.each([
    [false, '2026-09-14', 7],
    [true, '2026-09-09', 2],
  ] as const)(
    'Ultrasの判定が%pなら、敗北(2026-09-07)の後の選べる最も早い日は%sになる',
    async (entitled, earliest, interval) => {
      const { evaluate } = setup({ entitled });

      const states = await evaluate([lostProduct, wonProduct]);

      expect(states.get('p-lost')?.window?.earliest).toBe(day(earliest));
      expect(states.get('p-lost')?.window?.relaunchIntervalDays).toBe(interval);
      expect(states.get('p-lost')?.ultrasEntitled).toBe(entitled);
      expect(states.get('p-won')?.window?.earliest).toBe(day('2026-09-08'));
      expect(states.get('p-won')?.window?.relaunchIntervalDays).toBeNull();
      expect(states.get('p-won')?.ultrasEntitled).toBe(false);
    },
  );

  test('予定のローンチの変更は、その前の終了したローンチ(敗北)を基準に選べる日を求める', async () => {
    const { entitlementCalls, evaluate } = setup({ entitled: false });

    const states = await evaluate([scheduledProduct]);

    expect(states.get('p-scheduled')?.plan).toStrictEqual({
      mode: 'reschedule',
      launchId: 'l-scheduled',
      current: day('2026-09-20'),
      basis: { launchDate: day('2026-09-07'), outcome: 'lost' },
    });
    expect(states.get('p-scheduled')?.window?.earliest).toBe(day('2026-09-14'));
    expect(entitlementCalls).toHaveLength(1);
  });

  test('Ultrasの判定の失敗は、敗北が基準のプロダクトの計画を確認できない状態にし、他のプロダクトは判定する', async () => {
    const { evaluate } = setup({ entitled: new Error('判定の失敗') });

    const states = await evaluate([lostProduct, wonProduct]);

    expect(states.get('p-lost')?.plan).toStrictEqual({ mode: 'unknown' });
    expect(states.get('p-lost')?.window).toBeNull();
    expect(states.get('p-lost')?.ultrasEntitled).toBe(false);
    expect(states.get('p-won')?.plan.mode).toBe('new');
    expect(states.get('p-won')?.window?.earliest).toBe(day('2026-09-08'));
    expect(records).toHaveLength(1);
    expect(records[0]?.level).toBe('warning');
  });

  test('ローンチがローンチ日の新しい順でなく渡されても、直近のローンチで判定する', async () => {
    const { evaluate } = setup();

    const states = await evaluate([
      product('p-scheduled', [...scheduledProduct.launches].reverse()),
    ]);

    expect(states.get('p-scheduled')?.plan.mode).toBe('reschedule');
    expect(states.get('p-scheduled')?.latestLaunch?.launchId).toBe(
      'l-scheduled',
    );
  });

  test('非公開化中のプロダクトは次回の予約を禁止する', async () => {
    const { evaluate } = setup();

    expect(
      await stateOf(
        evaluate([product('p-hidden', wonProduct.launches, true)]),
        'p-hidden',
      ),
    ).toMatchObject({
      plan: {
        mode: 'blocked',
        blocks: [{ code: 'product_hidden' }],
      },
      window: null,
    });
  });

  test('プロダクトが無ければ、供給元とUltrasの判定を呼ばずに空の結果を返す', async () => {
    const { calls, entitlementCalls, evaluate } = setup();

    expect((await evaluate([])).size).toBe(0);
    expect(calls).toStrictEqual([]);
    expect(entitlementCalls).toStrictEqual([]);
  });

  test(`${String(PRODUCT_STATE_BATCH_MAX)}件を超えるプロダクトは、供給元を呼ばずに拒否する`, async () => {
    const { calls, evaluate } = setup();
    const products = Array.from(
      { length: PRODUCT_STATE_BATCH_MAX + 1 },
      (_, index) => product(`p-${String(index)}`, []),
    );

    expect(
      (await evaluate(products.slice(0, PRODUCT_STATE_BATCH_MAX))).size,
    ).toBe(PRODUCT_STATE_BATCH_MAX);
    calls.length = 0;
    const error = await evaluate(products).then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(RangeError);
    expect(calls).toStrictEqual([]);
  });
});
