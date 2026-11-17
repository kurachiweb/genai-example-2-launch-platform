import { describe, expect, test } from 'bun:test';

import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type {
  YearEntryFollowUp,
  YearEntryRecord,
  YearEntryStore,
} from '../../../lib/core/year-tournament/ports.ts';
import { AccountEntryLossHandler } from './account-entry-loss-handler.ts';

const NOW = new Date('2027-03-10T09:00:00.000Z');

const UPDATED_UNTIL = new Date('2027-03-10T09:00:00.001Z');

const USER_ID = '01JD0USER00000000000000001';

const OTHER_USER_ID = '01JD0USER00000000000000002';

const PAID_ENTRY_ID = '01JD0YENT00000000000000001';

const UNPAID_ENTRY_ID = '01JD0YENT00000000000000002';

const CLASSIFIED_ENTRY_ID = '01JD0YENT00000000000000003';

const OTHER_ENTRY_ID = '01JD0YENT00000000000000009';

const clock: Clock = { now: () => NOW };

const EVENT: UserLifecycleEvent = Object.freeze({
  id: '01JD0UEVT00000000000000001',
  userId: USER_ID,
  type: 'withdrawn',
  occurredAt: new Date('2027-03-10T08:59:00.000Z'),
});

function entryOf(
  entryId: string,
  columns: Partial<YearEntryRecord> = {},
): YearEntryRecord {
  return Object.freeze({
    entryId,
    weekTournamentId: `01JD0WTRN${entryId.slice(-17)}`,
    weekPeriod: '2027-W08',
    launchId: `01JD01NCH${entryId.slice(-17)}`,
    productId: '01JD0PR0D00000000000000001',
    ownerUserId: USER_ID,
    launchDate: parseBusinessDate('2027-02-22'),
    qualifierUpvoteCount: 12,
    qualifierLastUpvoteElapsedMs: 3_600_000,
    awardedAt: new Date('2027-02-28T07:40:05.000Z'),
    awardedDate: parseBusinessDate('2027-02-28'),
    status: 'forfeited',
    entitlementSource: 'payment',
    purchaseId: '01JD0PRCH00000000000000001',
    closeReason: 'withdrawn',
    classifiedYear: null,
    refundStatus: 'pending',
    refundNoticeStatus: 'none',
    ...columns,
  });
}

const PAID_ENTRY = entryOf(PAID_ENTRY_ID);

const CLASSIFIED_ENTRY = entryOf(CLASSIFIED_ENTRY_ID, {
  closeReason: 'deleted',
  classifiedYear: 2027,
});

const OTHER_ENTRY = entryOf(OTHER_ENTRY_ID, {
  ownerUserId: OTHER_USER_ID,
  productId: '01JD0PR0D00000000000000009',
});

function notUsed(): never {
  throw new Error('退会による参加資格の喪失の処理はこの操作を使わない');
}

type Call =
  | {
      readonly kind: 'forfeit';
      readonly userId: string;
      readonly at: Date;
    }
  | {
      readonly kind: 'listPending';
      readonly olderThan: Date;
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
  readonly pending?: readonly YearEntryRecord[];
  // 失敗した枠は返金待ちに残る
  readonly failure?: { readonly on: Call['kind']; readonly error: Error };
}

interface Harness {
  readonly handler: AccountEntryLossHandler;
  readonly calls: Call[];
}

function createHarness(options: HarnessOptions = {}): Harness {
  const { failure } = options;
  let forfeited = options.forfeited ?? [PAID_ENTRY_ID, UNPAID_ENTRY_ID];
  let pending = [...(options.pending ?? [PAID_ENTRY, OTHER_ENTRY])];
  const calls: Call[] = [];
  const settle = <T>(call: Call, value: () => T): Promise<T> => {
    calls.push(call);
    return failure?.on === call.kind
      ? Promise.reject(failure.error)
      : Promise.resolve(value());
  };
  const store: YearEntryStore = {
    insertFromChampion: notUsed,
    findByWeekTournaments: notUsed,
    findByLaunches: notUsed,
    findEntry: notUsed,
    listOpenByOwner: notUsed,
    listLaunchIdsByProduct: notUsed,
    listCandidates: notUsed,
    listDrawn: notUsed,
    grantByUltras: notUsed,
    forfeitByProduct: notUsed,
    forfeitByOwner: (userId, at) =>
      settle({ kind: 'forfeit', userId, at }, () => {
        const changed = forfeited;
        forfeited = [];
        return changed;
      }),
    classify: notUsed,
    excludeOverCapacity: notUsed,
    listPendingFollowUps: (olderThan, limit) =>
      settle({ kind: 'listPending', olderThan, limit }, () =>
        pending.slice(0, limit),
      ),
    markRefundRequested: notUsed,
    markRefundClosed: notUsed,
    markNotice: notUsed,
    unlinkOrDeleteByProduct: notUsed,
  };
  const followUp: YearEntryFollowUp = {
    process: (entryIds, now) =>
      settle({ kind: 'process', entryIds, now }, () => {
        pending = pending.filter(({ entryId }) => !entryIds.includes(entryId));
      }),
    processYear: notUsed,
  };
  return {
    handler: new AccountEntryLossHandler(store, followUp, clock),
    calls,
  };
}

const FORFEIT_CALL: Call = { kind: 'forfeit', userId: USER_ID, at: NOW };

const LIST_PENDING_CALL: Call = {
  kind: 'listPending',
  olderThan: UPDATED_UNTIL,
  limit: 50,
};

function processOf(...entryIds: string[]): Call {
  return { kind: 'process', entryIds, now: NOW };
}

function caughtOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
}

describe('AccountEntryLossHandler', () => {
  test('退会で、凍結前の枠を喪失にして喪失にした枠の返金待ちを処理し、残る返金待ちから退会した利用者の枠を探して完了を返す', async () => {
    const { handler, calls } = createHarness();

    const outcome = await handler.handle(EVENT);

    expect(outcome).toEqual({ kind: 'done' });
    expect(calls).toEqual([
      FORFEIT_CALL,
      processOf(PAID_ENTRY_ID, UNPAID_ENTRY_ID),
      LIST_PENDING_CALL,
      LIST_PENDING_CALL,
    ]);
  });

  test('凍結の後に届いた退会では喪失が0件で、組み合わせ決定の分類で喪失にした退会した利用者の枠の返金待ちだけを処理する', async () => {
    const { handler, calls } = createHarness({
      forfeited: [],
      pending: [OTHER_ENTRY, CLASSIFIED_ENTRY],
    });

    const outcome = await handler.handle(EVENT);

    expect(outcome).toEqual({ kind: 'done' });
    expect(calls).toEqual([
      FORFEIT_CALL,
      LIST_PENDING_CALL,
      processOf(CLASSIFIED_ENTRY_ID),
      LIST_PENDING_CALL,
    ]);
  });

  test('返金待ちの枠が無ければ、返金の依頼と知らせの処理を呼ばない', async () => {
    const { handler, calls } = createHarness({ forfeited: [], pending: [] });

    const outcome = await handler.handle(EVENT);

    expect(outcome).toEqual({ kind: 'done' });
    expect(calls).toEqual([FORFEIT_CALL, LIST_PENDING_CALL]);
  });

  test('返金の依頼と知らせの処理が失敗しても残りの読み取りを試し、失敗した枠を読み直さずに失敗を投げてイベントの再試行に任せる', async () => {
    const error = new Error('Stripeが一時的に応答しない');
    const { handler, calls } = createHarness({
      pending: [PAID_ENTRY, CLASSIFIED_ENTRY],
      failure: { on: 'process', error },
    });

    const caught = await caughtOf(handler.handle(EVENT));

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([error, error]);
    expect(calls).toEqual([
      FORFEIT_CALL,
      processOf(PAID_ENTRY_ID, UNPAID_ENTRY_ID),
      LIST_PENDING_CALL,
      processOf(CLASSIFIED_ENTRY_ID),
      LIST_PENDING_CALL,
    ]);
  });

  test('1回の処理だけの失敗は、その失敗をそのまま投げる', async () => {
    const error = new Error('Stripeが一時的に応答しない');
    const { handler } = createHarness({
      pending: [PAID_ENTRY],
      failure: { on: 'process', error },
    });

    const caught = await caughtOf(handler.handle(EVENT));

    expect(caught).toBe(error);
  });

  test.each(['forfeit', 'listPending'] as const)(
    '%sの失敗はそのまま投げ、イベントの再試行に任せる',
    async (on) => {
      const error = new Error('D1が一時的に応答しない');
      const { handler } = createHarness({ failure: { on, error } });

      const caught = await caughtOf(handler.handle(EVENT));

      expect(caught).toBe(error);
    },
  );
});
