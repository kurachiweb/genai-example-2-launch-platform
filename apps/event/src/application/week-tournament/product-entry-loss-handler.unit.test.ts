import { describe, expect, test } from 'bun:test';

import type { OpenCheckoutExpirer } from '../../../lib/core/payments/ports.ts';
import type { ProductLifecycleEvent } from '../../../lib/core/product/product-lifecycle.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import type {
  WeekEntryFollowUp,
  WeekEntryRecord,
  WeekFollowUpTarget,
  WeekTournamentStore,
} from '../../../lib/core/week-tournament/ports.ts';
import { ProductEntryLossHandler } from './product-entry-loss-handler.ts';

type ExpireOpenInput = Parameters<OpenCheckoutExpirer['expireOpen']>[0];

type ExpireOpenResult = Awaited<ReturnType<OpenCheckoutExpirer['expireOpen']>>;

const NOW = new Date('2026-11-20T09:00:00.000Z');

const PRODUCT_ID = '01JD0PR0D00000000000000001';

const OWNER_USER_ID = '01JD0USER00000000000000001';

const FIRST_ENTRY_ID = '01JD0WENT00000000000000001';

const SECOND_ENTRY_ID = '01JD0WENT00000000000000002';

const FIRST_LAUNCH_ID = '01JD01NCH00000000000000001';

const SECOND_LAUNCH_ID = '01JD01NCH00000000000000002';

const PENDING_ENTRY_ID = '01JD0WENT00000000000000009';

const clock: Clock = { now: () => NOW };

const EVENT: ProductLifecycleEvent = Object.freeze({
  id: '01JD0PEVT00000000000000001',
  productId: PRODUCT_ID,
  ownerUserId: OWNER_USER_ID,
  type: 'deleted',
  occurredAt: new Date('2026-11-20T08:59:00.000Z'),
});

const PENDING_ENTRY: WeekEntryRecord = Object.freeze({
  entryId: PENDING_ENTRY_ID,
  tournamentId: '01JD0WTRN00000000000000001',
  launchId: FIRST_LAUNCH_ID,
  productId: PRODUCT_ID,
  ownerUserId: OWNER_USER_ID,
  launchDate: parseBusinessDate('2026-11-17'),
  qualifierUpvoteCount: 12,
  qualifierLastUpvoteElapsedMs: 3_600_000,
  wonAt: new Date('2026-11-18T07:40:05.000Z'),
  status: 'forfeited',
  entitlementSource: null,
  purchaseId: '01JD0PRCH00000000000000009',
  closeReason: 'deleted',
  refundStatus: 'pending',
  refundNoticeStatus: 'none',
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
      readonly reason: 'deleted';
      readonly at: Date;
    }
  | { readonly kind: 'listLaunches'; readonly productId: string }
  | { readonly kind: 'expireOpen'; readonly input: ExpireOpenInput }
  | {
      readonly kind: 'listPending';
      readonly target: WeekFollowUpTarget;
      readonly limit: number;
    }
  | {
      readonly kind: 'process';
      readonly entryIds: readonly string[];
      readonly now: Date;
    };

interface HarnessOptions {
  // 喪失は1回目の呼び出しだけが枠を書き換え、呼び直しでは0件になる
  readonly forfeited?: readonly string[];
  readonly launchIds?: readonly string[];
  readonly pending?: readonly WeekEntryRecord[];
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
  let forfeited = options.forfeited ?? [FIRST_ENTRY_ID, SECOND_ENTRY_ID];
  let failuresLeft = failure?.times ?? Number.POSITIVE_INFINITY;
  const pending = [...(options.pending ?? [PENDING_ENTRY])];
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
  const store: WeekTournamentStore = {
    ensureTournament: notUsed,
    findTournament: notUsed,
    findTournamentByWeek: notUsed,
    findTournamentsByWeeks: notUsed,
    listDue: notUsed,
    listInProgress: notUsed,
    findEntriesByLaunch: notUsed,
    findEntry: notUsed,
    listLaunchIdsByProduct: (productId) =>
      settle({ kind: 'listLaunches', productId }, () => launchIds),
    listEntriesForClassification: notUsed,
    listDrawnEntries: notUsed,
    insertEntry: notUsed,
    grantByUltras: notUsed,
    forfeitByProduct: (productId, reason, at) =>
      settle({ kind: 'forfeit', productId, reason, at }, () => {
        const changed = forfeited;
        forfeited = [];
        return changed;
      }),
    forfeitByOwner: notUsed,
    freeze: notUsed,
    classify: notUsed,
    markDrawn: notUsed,
    recordFinish: notUsed,
    listAwardedBetween: notUsed,
    listPendingFollowUps: notUsed,
    listPendingFollowUpsOf: (target, limit) =>
      settle({ kind: 'listPending', target, limit }, () =>
        pending.slice(0, limit),
      ),
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
  const followUp: WeekEntryFollowUp = {
    process: (entryIds, now) =>
      settle({ kind: 'process', entryIds, now }, () => {
        pending.splice(0, pending.length);
      }),
    processTournament: notUsed,
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
      kinds: ['week_tournament_entry'],
      targetId: launchId,
      limit: 50,
    },
  };
}

const FORFEIT_CALL: Call = {
  kind: 'forfeit',
  productId: PRODUCT_ID,
  reason: 'deleted',
  at: NOW,
};

const LIST_LAUNCHES_CALL: Call = {
  kind: 'listLaunches',
  productId: PRODUCT_ID,
};

const EXPIRY_CALLS: readonly Call[] = [
  expiryOf(FIRST_LAUNCH_ID),
  expiryOf(SECOND_LAUNCH_ID),
];

const FOLLOW_UP_CALLS: readonly Call[] = [
  { kind: 'listPending', target: { productId: PRODUCT_ID }, limit: 50 },
  { kind: 'process', entryIds: [PENDING_ENTRY_ID], now: NOW },
  { kind: 'listPending', target: { productId: PRODUCT_ID }, limit: 50 },
];

const NO_PENDING_CALLS: readonly Call[] = [
  { kind: 'listPending', target: { productId: PRODUCT_ID }, limit: 50 },
];

function caughtOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
}

describe('ProductEntryLossHandler', () => {
  test('削除で、凍結前の枠を喪失にし、プロダクトのローンチごとに参加費の未完了の決済を失効させ、プロダクトの返金待ちの枠を処理して完了を返す', async () => {
    const { handler, calls } = createHarness();

    const outcome = await handler.handle(EVENT);

    expect(outcome).toEqual({ kind: 'done' });
    expect(calls).toEqual([
      FORFEIT_CALL,
      LIST_LAUNCHES_CALL,
      ...EXPIRY_CALLS,
      ...FOLLOW_UP_CALLS,
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
      ...FOLLOW_UP_CALLS,
    ]);
  });

  test('続きの呼び出しでもプロダクトのローンチを失効させ、残りが無くなれば完了を返す', async () => {
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
      ...NO_PENDING_CALLS,
    ]);
  });

  test('喪失が0件になる呼び直しでも、プロダクトのローンチの未完了の決済を失効させる', async () => {
    const { handler, calls } = createHarness({
      expiries: [EXPIRED_ALL, EXPIRED_ALL, EXPIRED_ALL, EXPIRED_ALL],
    });

    await handler.handle(EVENT);
    calls.splice(0, calls.length);
    const outcome = await handler.handle(EVENT);

    expect(outcome).toEqual({ kind: 'done' });
    expect(calls).toEqual([
      FORFEIT_CALL,
      LIST_LAUNCHES_CALL,
      ...EXPIRY_CALLS,
      ...NO_PENDING_CALLS,
    ]);
  });

  test('失効の失敗の後の再試行で、プロダクトのローンチを失効させ直す', async () => {
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
      ...FOLLOW_UP_CALLS,
    ]);
  });

  test('凍結の後に届いた削除では喪失が0件でも、プロダクトのローンチの失効と返金待ちの枠の処理を行う', async () => {
    const { handler, calls } = createHarness({ forfeited: [] });

    const outcome = await handler.handle(EVENT);

    expect(outcome).toEqual({ kind: 'done' });
    expect(calls).toEqual([
      FORFEIT_CALL,
      LIST_LAUNCHES_CALL,
      ...EXPIRY_CALLS,
      ...FOLLOW_UP_CALLS,
    ]);
  });

  test('枠のローンチが無ければ失効を呼ばない', async () => {
    const { handler, calls } = createHarness({ launchIds: [], expiries: [] });

    const outcome = await handler.handle(EVENT);

    expect(outcome).toEqual({ kind: 'done' });
    expect(calls.filter(({ kind }) => kind === 'expireOpen')).toEqual([]);
  });

  test('返金待ちの枠が無ければ、返金の依頼と知らせの処理を呼ばない', async () => {
    const { handler, calls } = createHarness({ pending: [] });

    await handler.handle(EVENT);

    expect(calls.filter(({ kind }) => kind === 'process')).toEqual([]);
  });

  test.each(['forfeit', 'listLaunches', 'expireOpen'] as const)(
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
