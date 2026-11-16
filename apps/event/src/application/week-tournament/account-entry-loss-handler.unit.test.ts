import { describe, expect, test } from 'bun:test';

import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import type {
  WeekEntryFollowUp,
  WeekEntryRecord,
  WeekFollowUpTarget,
  WeekTournamentStore,
} from '../../../lib/core/week-tournament/ports.ts';
import { AccountEntryLossHandler } from './account-entry-loss-handler.ts';

const NOW = new Date('2026-11-20T09:00:00.000Z');

const USER_ID = '01JD0USER00000000000000001';

const PENDING_ENTRY_ID = '01JD0WENT00000000000000001';

const clock: Clock = { now: () => NOW };

const EVENT: UserLifecycleEvent = Object.freeze({
  id: '01JD0UEVT00000000000000001',
  userId: USER_ID,
  type: 'withdrawn',
  occurredAt: new Date('2026-11-20T08:59:00.000Z'),
});

const PENDING_ENTRY: WeekEntryRecord = Object.freeze({
  entryId: PENDING_ENTRY_ID,
  tournamentId: '01JD0WTRN00000000000000001',
  launchId: '01JD01NCH00000000000000001',
  productId: '01JD0PR0D00000000000000001',
  ownerUserId: USER_ID,
  launchDate: parseBusinessDate('2026-11-17'),
  qualifierUpvoteCount: 12,
  qualifierLastUpvoteElapsedMs: 3_600_000,
  wonAt: new Date('2026-11-18T07:40:05.000Z'),
  status: 'forfeited',
  entitlementSource: null,
  purchaseId: '01JD0PRCH00000000000000001',
  closeReason: 'withdrawn',
  refundStatus: 'pending',
  refundNoticeStatus: 'none',
});

function notUsed(): never {
  throw new Error('退会による参加資格の喪失の処理はこの操作を使わない');
}

type Call =
  | {
      readonly kind: 'forfeit';
      readonly userId: string;
      readonly reason: 'withdrawn';
      readonly at: Date;
    }
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
  readonly forfeited?: readonly string[];
  readonly pending?: readonly WeekEntryRecord[];
  readonly failure?: { readonly on: Call['kind']; readonly error: Error };
}

interface Harness {
  readonly handler: AccountEntryLossHandler;
  readonly calls: Call[];
}

function createHarness(options: HarnessOptions = {}): Harness {
  const { forfeited = [PENDING_ENTRY_ID], failure } = options;
  const pending = [...(options.pending ?? [PENDING_ENTRY])];
  const calls: Call[] = [];
  const settle = <T>(call: Call, value: () => T): Promise<T> => {
    calls.push(call);
    return failure?.on === call.kind
      ? Promise.reject(failure.error)
      : Promise.resolve(value());
  };
  const store: WeekTournamentStore = {
    ensureTournament: notUsed,
    findTournament: notUsed,
    findTournamentByWeek: notUsed,
    listDue: notUsed,
    listInProgress: notUsed,
    findEntriesByLaunch: notUsed,
    findEntry: notUsed,
    listLaunchIdsByProduct: notUsed,
    listEntriesForClassification: notUsed,
    listDrawnEntries: notUsed,
    insertEntry: notUsed,
    grantByUltras: notUsed,
    forfeitByProduct: notUsed,
    forfeitByOwner: (userId, reason, at) =>
      settle({ kind: 'forfeit', userId, reason, at }, () => forfeited),
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
  const followUp: WeekEntryFollowUp = {
    process: (entryIds, now) =>
      settle({ kind: 'process', entryIds, now }, () => {
        pending.splice(0, pending.length);
      }),
    processTournament: notUsed,
  };
  return {
    handler: new AccountEntryLossHandler(store, followUp, clock),
    calls,
  };
}

const FOLLOW_UP_CALLS: readonly Call[] = [
  { kind: 'listPending', target: { ownerUserId: USER_ID }, limit: 50 },
  { kind: 'process', entryIds: [PENDING_ENTRY_ID], now: NOW },
  { kind: 'listPending', target: { ownerUserId: USER_ID }, limit: 50 },
];

describe('AccountEntryLossHandler', () => {
  test('退会で、投稿者の凍結前の枠を喪失にし、投稿者の返金待ちの枠を処理して完了を返す', async () => {
    const { handler, calls } = createHarness();

    const outcome = await handler.handle(EVENT);

    expect(outcome).toEqual({ kind: 'done' });
    expect(calls).toEqual([
      { kind: 'forfeit', userId: USER_ID, reason: 'withdrawn', at: NOW },
      ...FOLLOW_UP_CALLS,
    ]);
  });

  test('凍結の後に届いた退会では喪失が0件でも、組み合わせ決定で喪失にした枠の返金待ちを処理する', async () => {
    const { handler, calls } = createHarness({ forfeited: [] });

    const outcome = await handler.handle(EVENT);

    expect(outcome).toEqual({ kind: 'done' });
    expect(calls).toEqual([
      { kind: 'forfeit', userId: USER_ID, reason: 'withdrawn', at: NOW },
      ...FOLLOW_UP_CALLS,
    ]);
  });

  test('返金待ちの枠が無ければ、返金の依頼と知らせの処理を呼ばない', async () => {
    const { handler, calls } = createHarness({ pending: [] });

    await handler.handle(EVENT);

    expect(calls.filter(({ kind }) => kind === 'process')).toEqual([]);
  });

  test.each(['forfeit', 'process'] as const)(
    '%sの失敗はそのまま投げ、イベントの再試行に任せる',
    async (on) => {
      const error = new Error('一時的な失敗');
      const { handler } = createHarness({ failure: { on, error } });

      const caught = await handler
        .handle(EVENT)
        .catch((thrown: unknown) => thrown);

      expect(caught).toBe(error);
    },
  );
});
