import { describe, expect, test } from 'bun:test';

import type { Clock } from '../../../lib/core/time/clock.ts';
import type { UltrasActivation } from '../../../lib/core/ultras/activation-contract.ts';
import type { WeekTournamentStore } from '../../../lib/core/week-tournament/ports.ts';
import {
  GRANTABLE_STATUSES,
  type WeekEntitlementSource,
  type WeekEntryStatus,
} from '../../../lib/core/week-tournament/week-entry-rules.ts';
import { WeekUltrasEntryExemptionHandler } from './week-ultras-entry-exemption-handler.ts';

const USER_ID = '01JD0USER00000000000000001';

const OTHER_USER_ID = '01JD0USER00000000000000002';

const OPEN_ENTRY_ID = '01JD0WENT00000000000000001';

const PAID_ENTRY_ID = '01JD0WENT00000000000000002';

const OTHER_USER_ENTRY_ID = '01JD0WENT00000000000000003';

const WON_AT = new Date('2026-11-18T07:40:05.000Z');

const DEADLINE_AT = new Date('2026-11-24T07:00:00.000Z');

// 知らせの処理は加入の有効化より後に動き、決済期限を過ぎてから届くこともある
const NOW = new Date('2026-11-24T07:10:00.000Z');

const clock: Clock = { now: () => NOW };

function activationAt(activatedAt: Date): UltrasActivation {
  return Object.freeze({
    activationId: '01JC0ACTVTN000000000000001',
    userId: USER_ID,
    stripeSubscriptionId: 'sub_0123456789abcdef',
    activatedAt,
  });
}

function notUsed(): never {
  throw new Error('Ultrasによる参加費の免除の処理はこの操作を使わない');
}

interface FakeEntry {
  readonly entryId: string;
  readonly ownerUserId: string;
  readonly status: WeekEntryStatus;
  readonly entitlementSource: WeekEntitlementSource | null;
  readonly wonAt: Date;
  readonly deadlineAt: Date;
}

interface GrantCall {
  readonly userId: string;
  readonly activatedAt: Date;
  readonly at: Date;
}

interface Harness {
  readonly handler: WeekUltrasEntryExemptionHandler;
  readonly calls: GrantCall[];
  readonly entries: () => readonly FakeEntry[];
}

const INITIAL_ENTRIES: readonly FakeEntry[] = Object.freeze([
  {
    entryId: OPEN_ENTRY_ID,
    ownerUserId: USER_ID,
    status: 'awaiting_payment',
    entitlementSource: null,
    wonAt: WON_AT,
    deadlineAt: DEADLINE_AT,
  },
  {
    entryId: PAID_ENTRY_ID,
    ownerUserId: USER_ID,
    status: 'entitled',
    entitlementSource: 'payment',
    wonAt: WON_AT,
    deadlineAt: DEADLINE_AT,
  },
  {
    entryId: OTHER_USER_ENTRY_ID,
    ownerUserId: OTHER_USER_ID,
    status: 'awaiting_payment',
    entitlementSource: null,
    wonAt: WON_AT,
    deadlineAt: DEADLINE_AT,
  },
]);

// ストアの契約(凍結前の週の受付中の枠のうち、勝利の確定 ≤ 有効化 ≤ 決済期限のものに参加資格を与える)を写した偽物
function createHarness(failure?: Error): Harness {
  let entries: readonly FakeEntry[] = INITIAL_ENTRIES;
  const calls: GrantCall[] = [];
  const isGrantable = (
    entry: FakeEntry,
    userId: string,
    activatedAt: Date,
  ): boolean =>
    entry.ownerUserId === userId &&
    GRANTABLE_STATUSES.some((status) => status === entry.status) &&
    entry.wonAt.getTime() <= activatedAt.getTime() &&
    activatedAt.getTime() <= entry.deadlineAt.getTime();
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
    grantByUltras: (userId, activatedAt, at) => {
      calls.push({ userId, activatedAt, at });
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      const granted = entries
        .filter((entry) => isGrantable(entry, userId, activatedAt))
        .map(({ entryId }) => entryId);
      entries = entries.map((entry) =>
        granted.includes(entry.entryId)
          ? { ...entry, status: 'entitled', entitlementSource: 'ultras' }
          : entry,
      );
      return Promise.resolve(granted);
    },
    forfeitByProduct: notUsed,
    forfeitByOwner: notUsed,
    freeze: notUsed,
    classify: notUsed,
    markDrawn: notUsed,
    recordFinish: notUsed,
    listAwardedBetween: notUsed,
    listPendingFollowUps: notUsed,
    listPendingFollowUpsOf: notUsed,
    markRefundRequested: notUsed,
    markRefundClosed: notUsed,
    markNotice: notUsed,
    unlinkOrDeleteByProduct: notUsed,
  };
  return {
    handler: new WeekUltrasEntryExemptionHandler(store, clock),
    calls,
    entries: () => entries,
  };
}

function statusesOf(
  entries: readonly FakeEntry[],
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    entries.map(({ entryId, status, entitlementSource }) => [
      entryId,
      `${status}:${String(entitlementSource)}`,
    ]),
  );
}

describe('WeekUltrasEntryExemptionHandler', () => {
  test('決済期限より前に有効になった加入では、知らせが期限の後に届いても加入者の受付中の枠に参加資格を与える', async () => {
    const activatedAt = new Date('2026-11-24T06:59:59.000Z');
    const { handler, calls, entries } = createHarness();

    await handler.handle(activationAt(activatedAt));

    expect(calls).toEqual([{ userId: USER_ID, activatedAt, at: NOW }]);
    expect(statusesOf(entries())).toEqual({
      [OPEN_ENTRY_ID]: 'entitled:ultras',
      [PAID_ENTRY_ID]: 'entitled:payment',
      [OTHER_USER_ENTRY_ID]: 'awaiting_payment:null',
    });
  });

  test('決済期限ちょうどに有効になった加入でも参加資格を与える', async () => {
    const { handler, entries } = createHarness();

    await handler.handle(activationAt(DEADLINE_AT));

    expect(statusesOf(entries())[OPEN_ENTRY_ID]).toBe('entitled:ultras');
  });

  test('決済期限の後に有効になった加入では参加資格を与えない', async () => {
    const activatedAt = new Date('2026-11-24T07:00:00.001Z');
    const { handler, calls, entries } = createHarness();

    await handler.handle(activationAt(activatedAt));

    expect(calls).toEqual([{ userId: USER_ID, activatedAt, at: NOW }]);
    expect(statusesOf(entries())).toEqual(statusesOf(INITIAL_ENTRIES));
  });

  test('同じ知らせを2回処理しても結果が変わらない', async () => {
    const activation = activationAt(new Date('2026-11-20T09:00:00.000Z'));
    const { handler, entries } = createHarness();

    await handler.handle(activation);
    const afterFirst = statusesOf(entries());
    await handler.handle(activation);

    expect(statusesOf(entries())).toEqual(afterFirst);
    expect(afterFirst[OPEN_ENTRY_ID]).toBe('entitled:ultras');
  });

  test('ストアの失敗はそのまま投げ、知らせ全体の再試行に任せる', async () => {
    const error = new Error('一時的な失敗');
    const { handler } = createHarness(error);

    const caught = await handler
      .handle(activationAt(new Date('2026-11-20T09:00:00.000Z')))
      .catch((thrown: unknown) => thrown);

    expect(caught).toBe(error);
  });
});
