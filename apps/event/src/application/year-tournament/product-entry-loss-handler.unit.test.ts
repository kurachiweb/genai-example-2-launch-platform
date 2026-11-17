import { describe, expect, test } from 'bun:test';

import type { OpenCheckoutExpirer } from '../../../lib/core/payments/ports.ts';
import type { ProductLifecycleEvent } from '../../../lib/core/product/product-lifecycle.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type {
  YearEntryFollowUp,
  YearEntryRecord,
  YearEntryStore,
} from '../../../lib/core/year-tournament/ports.ts';
import { ProductEntryLossHandler } from './product-entry-loss-handler.ts';

type ExpireOpenInput = Parameters<OpenCheckoutExpirer['expireOpen']>[0];

type ExpireOpenResult = Awaited<ReturnType<OpenCheckoutExpirer['expireOpen']>>;

const NOW = new Date('2027-03-10T09:00:00.000Z');

const PRODUCT_ID = '01JD0PR0D00000000000000001';

const OWNER_USER_ID = '01JD0USER00000000000000001';

const FIRST_LAUNCH_ID = '01JD01NCH00000000000000001';

const SECOND_LAUNCH_ID = '01JD01NCH00000000000000002';

const PAID_ENTRY_ID = '01JD0YENT00000000000000001';

const UNPAID_ENTRY_ID = '01JD0YENT00000000000000002';

const clock: Clock = { now: () => NOW };

const EVENT: ProductLifecycleEvent = Object.freeze({
  id: '01JD0PEVT00000000000000001',
  productId: PRODUCT_ID,
  ownerUserId: OWNER_USER_ID,
  type: 'deleted',
  occurredAt: new Date('2027-03-10T08:59:00.000Z'),
});

function entryOf(
  entryId: string,
  launchId: string,
  columns: Partial<YearEntryRecord> = {},
): YearEntryRecord {
  return Object.freeze({
    entryId,
    weekTournamentId: `01JD0WTRN${entryId.slice(-17)}`,
    weekPeriod: '2027-W08',
    launchId,
    productId: PRODUCT_ID,
    ownerUserId: OWNER_USER_ID,
    launchDate: parseBusinessDate('2027-02-22'),
    qualifierUpvoteCount: 12,
    qualifierLastUpvoteElapsedMs: 3_600_000,
    awardedAt: new Date('2027-02-28T07:40:05.000Z'),
    awardedDate: parseBusinessDate('2027-02-28'),
    status: 'forfeited',
    entitlementSource: 'payment',
    purchaseId: '01JD0PRCH00000000000000001',
    closeReason: 'deleted',
    classifiedYear: null,
    refundStatus: 'pending',
    refundNoticeStatus: 'none',
    ...columns,
  });
}

const PAID_ENTRY = entryOf(PAID_ENTRY_ID, FIRST_LAUNCH_ID);

const UNPAID_ENTRY = entryOf(UNPAID_ENTRY_ID, SECOND_LAUNCH_ID, {
  entitlementSource: null,
  purchaseId: null,
  refundStatus: 'not_needed',
});

const EXPIRED_ALL: ExpireOpenResult = Object.freeze({
  expired: 1,
  remaining: false,
});

const EXPIRED_PART: ExpireOpenResult = Object.freeze({
  expired: 50,
  remaining: true,
});

function notUsed(): never {
  throw new Error('削除による参加資格の喪失の処理はこの操作を使わない');
}

type Call =
  | {
      readonly kind: 'forfeit';
      readonly productId: string;
      readonly at: Date;
    }
  | { readonly kind: 'listLaunches'; readonly productId: string }
  | { readonly kind: 'expireOpen'; readonly input: ExpireOpenInput }
  | { readonly kind: 'findByLaunches'; readonly launchIds: readonly string[] }
  | {
      readonly kind: 'process';
      readonly entryIds: readonly string[];
      readonly now: Date;
    };

interface HarnessOptions {
  // 喪失は1回目の呼び出しだけが枠を書き換え、呼び直しでは0件になる
  readonly forfeited?: readonly string[];
  readonly launchIds?: readonly string[];
  readonly entries?: readonly YearEntryRecord[];
  readonly expiries?: readonly ExpireOpenResult[];
  // timesを指定すると、その回数だけ失敗した後は成功する
  readonly failure?: {
    readonly on: Call['kind'];
    readonly error: Error;
    readonly times?: number;
  };
}

interface Harness {
  readonly handler: ProductEntryLossHandler;
  readonly calls: Call[];
}

function createHarness(options: HarnessOptions = {}): Harness {
  const {
    launchIds = [FIRST_LAUNCH_ID, SECOND_LAUNCH_ID],
    expiries = [EXPIRED_ALL, EXPIRED_ALL],
    failure,
  } = options;
  let forfeited = options.forfeited ?? [PAID_ENTRY_ID, UNPAID_ENTRY_ID];
  let failuresLeft = failure?.times ?? Number.POSITIVE_INFINITY;
  let entries = [...(options.entries ?? [PAID_ENTRY, UNPAID_ENTRY])];
  const results = [...expiries];
  const calls: Call[] = [];
  const settle = <T>(call: Call, value: () => T): Promise<T> => {
    calls.push(call);
    if (failure?.on === call.kind && failuresLeft > 0) {
      failuresLeft -= 1;
      return Promise.reject(failure.error);
    }
    return Promise.resolve(value());
  };
  const store: YearEntryStore = {
    insertFromChampion: notUsed,
    findByWeekTournaments: notUsed,
    findByLaunches: (ids) =>
      settle({ kind: 'findByLaunches', launchIds: ids }, () => {
        const launched = entries.flatMap((entry) =>
          entry.launchId !== null && ids.includes(entry.launchId)
            ? [[entry.launchId, entry] as const]
            : [],
        );
        return new Map(launched);
      }),
    findEntry: notUsed,
    listOpenByOwner: notUsed,
    listLaunchIdsByProduct: (productId) =>
      settle({ kind: 'listLaunches', productId }, () => launchIds),
    listCandidates: notUsed,
    listDrawn: notUsed,
    grantByUltras: notUsed,
    forfeitByProduct: (productId, at) =>
      settle({ kind: 'forfeit', productId, at }, () => {
        const changed = forfeited;
        forfeited = [];
        return changed;
      }),
    forfeitByOwner: notUsed,
    classify: notUsed,
    excludeOverCapacity: notUsed,
    listPendingFollowUps: notUsed,
    markRefundRequested: notUsed,
    markRefundClosed: notUsed,
    markNotice: notUsed,
    unlinkOrDeleteByProduct: notUsed,
  };
  const expirer: OpenCheckoutExpirer = {
    expireOpen: (input) =>
      settle({ kind: 'expireOpen', input }, () => {
        const next = results.shift();
        if (next === undefined) {
          throw new Error('想定外の失効の呼び出し');
        }
        return next;
      }),
  };
  const followUp: YearEntryFollowUp = {
    process: (entryIds, now) =>
      settle({ kind: 'process', entryIds, now }, () => {
        entries = entries.map((entry) =>
          entryIds.includes(entry.entryId)
            ? {
                ...entry,
                refundStatus: 'requested',
                refundNoticeStatus: 'sent',
              }
            : entry,
        );
      }),
    processYear: notUsed,
  };
  return {
    handler: new ProductEntryLossHandler(store, expirer, followUp, clock),
    calls,
  };
}

function expiryOf(launchId: string): Call {
  return {
    kind: 'expireOpen',
    input: {
      userId: OWNER_USER_ID,
      kinds: ['year_tournament_entry'],
      targetId: launchId,
      limit: 50,
    },
  };
}

const FORFEIT_CALL: Call = { kind: 'forfeit', productId: PRODUCT_ID, at: NOW };

const LIST_LAUNCHES_CALL: Call = {
  kind: 'listLaunches',
  productId: PRODUCT_ID,
};

const EXPIRY_CALLS: readonly Call[] = [
  expiryOf(FIRST_LAUNCH_ID),
  expiryOf(SECOND_LAUNCH_ID),
];

const FIND_ENTRIES_CALL: Call = {
  kind: 'findByLaunches',
  launchIds: [FIRST_LAUNCH_ID, SECOND_LAUNCH_ID],
};

const PROCESS_PAID_CALL: Call = {
  kind: 'process',
  entryIds: [PAID_ENTRY_ID],
  now: NOW,
};

function caughtOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
}

describe('ProductEntryLossHandler', () => {
  test('削除で、凍結前の枠を喪失にし、枠のローンチごとに参加費の未完了の決済を失効させ、プロダクトの返金待ちの枠だけを処理して完了を返す', async () => {
    const { handler, calls } = createHarness();

    const outcome = await handler.handle(EVENT);

    expect(outcome).toEqual({ kind: 'done' });
    expect(calls).toEqual([
      FORFEIT_CALL,
      LIST_LAUNCHES_CALL,
      ...EXPIRY_CALLS,
      FIND_ENTRIES_CALL,
      PROCESS_PAID_CALL,
    ]);
  });

  test('未完了の決済の失効に残りがあれば、返金待ちの枠を処理してから続きを返す', async () => {
    const { handler, calls } = createHarness({
      expiries: [EXPIRED_PART, EXPIRED_ALL],
    });

    const outcome = await handler.handle(EVENT);

    expect(outcome).toEqual({ kind: 'continue' });
    expect(calls).toEqual([
      FORFEIT_CALL,
      LIST_LAUNCHES_CALL,
      ...EXPIRY_CALLS,
      FIND_ENTRIES_CALL,
      PROCESS_PAID_CALL,
    ]);
  });

  test('喪失が0件になる続きの呼び出しでも枠のローンチを失効させ、残りが無くなれば完了を返す', async () => {
    const { handler, calls } = createHarness({
      expiries: [EXPIRED_PART, EXPIRED_ALL, EXPIRED_ALL, EXPIRED_ALL],
    });

    const first = await handler.handle(EVENT);
    calls.splice(0, calls.length);
    const second = await handler.handle(EVENT);

    expect(first).toEqual({ kind: 'continue' });
    expect(second).toEqual({ kind: 'done' });
    expect(calls).toEqual([
      FORFEIT_CALL,
      LIST_LAUNCHES_CALL,
      ...EXPIRY_CALLS,
      FIND_ENTRIES_CALL,
    ]);
  });

  test('失効の失敗の後の再試行で、喪失が0件でも枠のローンチを失効させ直し、返金待ちの枠を処理する', async () => {
    const error = new Error('Stripeが一時的に応答しない');
    const { handler, calls } = createHarness({
      expiries: [EXPIRED_ALL, EXPIRED_ALL],
      failure: { on: 'expireOpen', error, times: 1 },
    });

    const caught = await caughtOf(handler.handle(EVENT));
    const processedBeforeRetry = calls.filter(({ kind }) => kind === 'process');
    calls.splice(0, calls.length);
    const outcome = await handler.handle(EVENT);

    expect(caught).toBe(error);
    expect(processedBeforeRetry).toEqual([]);
    expect(outcome).toEqual({ kind: 'done' });
    expect(calls).toEqual([
      FORFEIT_CALL,
      LIST_LAUNCHES_CALL,
      ...EXPIRY_CALLS,
      FIND_ENTRIES_CALL,
      PROCESS_PAID_CALL,
    ]);
  });

  test('凍結の後に届いた削除では喪失が0件で、組み合わせ決定の分類で喪失にした枠の返金待ちだけを処理する', async () => {
    const classified = entryOf(PAID_ENTRY_ID, FIRST_LAUNCH_ID, {
      classifiedYear: 2027,
    });
    const drawn = entryOf(UNPAID_ENTRY_ID, SECOND_LAUNCH_ID, {
      status: 'drawn',
      closeReason: null,
      classifiedYear: 2027,
      refundStatus: 'none',
    });
    const { handler, calls } = createHarness({
      forfeited: [],
      entries: [classified, drawn],
    });

    const outcome = await handler.handle(EVENT);

    expect(outcome).toEqual({ kind: 'done' });
    expect(calls).toEqual([
      FORFEIT_CALL,
      LIST_LAUNCHES_CALL,
      ...EXPIRY_CALLS,
      FIND_ENTRIES_CALL,
      PROCESS_PAID_CALL,
    ]);
  });

  test('返金の知らせだけが待ちの枠も処理する', async () => {
    const noticePending = entryOf(PAID_ENTRY_ID, FIRST_LAUNCH_ID, {
      refundStatus: 'requested',
      refundNoticeStatus: 'pending',
    });
    const { handler, calls } = createHarness({
      forfeited: [],
      entries: [noticePending, UNPAID_ENTRY],
    });

    await handler.handle(EVENT);

    expect(calls.filter(({ kind }) => kind === 'process')).toEqual([
      PROCESS_PAID_CALL,
    ]);
  });

  test('枠のローンチが無ければ失効も返金待ちの処理も呼ばない', async () => {
    const { handler, calls } = createHarness({
      forfeited: [],
      launchIds: [],
      entries: [],
      expiries: [],
    });

    const outcome = await handler.handle(EVENT);

    expect(outcome).toEqual({ kind: 'done' });
    expect(
      calls.filter(({ kind }) => kind === 'expireOpen' || kind === 'process'),
    ).toEqual([]);
  });

  test('返金待ちの枠が無ければ、返金の依頼と知らせの処理を呼ばない', async () => {
    const { handler, calls } = createHarness({ entries: [UNPAID_ENTRY] });

    await handler.handle(EVENT);

    expect(calls.filter(({ kind }) => kind === 'process')).toEqual([]);
  });

  test.each([
    'forfeit',
    'listLaunches',
    'expireOpen',
    'findByLaunches',
  ] as const)(
    '%sの失敗は返金待ちの枠を処理せずにそのまま投げ、イベントの再試行に任せる',
    async (on) => {
      const error = new Error('一時的な失敗');
      const { handler, calls } = createHarness({ failure: { on, error } });

      const caught = await caughtOf(handler.handle(EVENT));

      expect(caught).toBe(error);
      expect(calls.filter(({ kind }) => kind === 'process')).toEqual([]);
    },
  );

  test('返金の依頼と知らせの処理の失敗は、そのまま投げてイベントの再試行に任せる', async () => {
    const error = new Error('Stripeが一時的に応答しない');
    const { handler } = createHarness({ failure: { on: 'process', error } });

    const caught = await caughtOf(handler.handle(EVENT));

    expect(caught).toBe(error);
  });
});
