import { describe, expect, test } from 'bun:test';

import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import type {
  WeekEntryFollowUp,
  WeekEntryRecord,
  WeekFollowUpTarget,
  WeekTournamentStore,
} from '../../../lib/core/week-tournament/ports.ts';
import {
  followUpPendingEntries,
  PENDING_FOLLOW_UP_READ_LIMIT,
} from './follow-up-pending-entries.ts';

const NOW = new Date('2026-11-20T09:00:00.000Z');

const PRODUCT_ID = '01JD0PR0D00000000000000001';

const TARGET: WeekFollowUpTarget = Object.freeze({ productId: PRODUCT_ID });

function entryIdOf(index: number): string {
  return `01JD0WENT${String(index).padStart(17, '0')}`;
}

function pendingEntryOf(index: number): WeekEntryRecord {
  return Object.freeze({
    entryId: entryIdOf(index),
    tournamentId: '01JD0WTRN00000000000000001',
    launchId: `01JD01NCH${String(index).padStart(17, '0')}`,
    productId: PRODUCT_ID,
    ownerUserId: '01JD0USER00000000000000001',
    launchDate: parseBusinessDate('2026-11-17'),
    qualifierUpvoteCount: 12,
    qualifierLastUpvoteElapsedMs: 3_600_000,
    wonAt: new Date('2026-11-18T07:40:05.000Z'),
    status: 'forfeited',
    entitlementSource: null,
    purchaseId: `01JD0PRCH${String(index).padStart(17, '0')}`,
    closeReason: 'deleted',
    refundStatus: 'pending',
    refundNoticeStatus: 'none',
  });
}

function notUsed(): never {
  throw new Error('返金待ちの枠の処理はこの操作を使わない');
}

interface Harness {
  readonly store: WeekTournamentStore;
  readonly followUp: WeekEntryFollowUp;
  readonly reads: { readonly target: WeekFollowUpTarget; limit: number }[];
  readonly processed: {
    readonly entryIds: readonly string[];
    readonly now: Date;
  }[];
}

// 処理に成功した枠は返金待ちから外れ、失敗した枠は返金待ちに残って次の読み取りにも現れる
function createHarness(
  pending: readonly WeekEntryRecord[],
  failures: ReadonlyMap<string, Error> = new Map(),
): Harness {
  const remaining = [...pending];
  const reads: Harness['reads'] = [];
  const processed: Harness['processed'] = [];
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
    forfeitByOwner: notUsed,
    freeze: notUsed,
    classify: notUsed,
    markDrawn: notUsed,
    recordFinish: notUsed,
    listAwardedBetween: notUsed,
    listPendingFollowUps: notUsed,
    listPendingFollowUpsOf: (target, limit) => {
      reads.push({ target, limit });
      return Promise.resolve(remaining.slice(0, limit));
    },
    markRefundRequested: notUsed,
    markRefundClosed: notUsed,
    markNotice: notUsed,
    unlinkOrDeleteByProduct: notUsed,
  };
  const followUp: WeekEntryFollowUp = {
    process: (entryIds, now) => {
      processed.push({ entryIds, now });
      const errors = entryIds.flatMap((entryId) => {
        const error = failures.get(entryId);
        if (error === undefined) {
          remaining.splice(
            remaining.findIndex((entry) => entry.entryId === entryId),
            1,
          );
          return [];
        }
        return [error];
      });
      const [first] = errors;
      return first === undefined ? Promise.resolve() : Promise.reject(first);
    },
    processTournament: notUsed,
  };
  return { store, followUp, reads, processed };
}

describe('followUpPendingEntries', () => {
  test('1回の読み取りの件数は50件である', () => {
    expect(PENDING_FOLLOW_UP_READ_LIMIT).toBe(50);
  });

  test('対象の返金待ちの枠を読んで返金の依頼と知らせの処理に渡し、返金待ちが無くなったら終える', async () => {
    const harness = createHarness([pendingEntryOf(1), pendingEntryOf(2)]);

    await followUpPendingEntries(harness.store, harness.followUp, TARGET, NOW);

    expect(harness.reads).toEqual([
      { target: TARGET, limit: 50 },
      { target: TARGET, limit: 50 },
    ]);
    expect(harness.processed).toEqual([
      { entryIds: [entryIdOf(1), entryIdOf(2)], now: NOW },
    ]);
  });

  test('返金待ちの枠が無ければ処理に何も渡さない', async () => {
    const harness = createHarness([]);

    await followUpPendingEntries(harness.store, harness.followUp, TARGET, NOW);

    expect(harness.reads).toHaveLength(1);
    expect(harness.processed).toEqual([]);
  });

  test('読み取りの件数を超える返金待ちの枠も、続けて読んで全て処理する', async () => {
    const pending = Array.from({ length: 51 }, (_, index) =>
      pendingEntryOf(index + 1),
    );
    const harness = createHarness(pending);

    await followUpPendingEntries(harness.store, harness.followUp, TARGET, NOW);

    expect(harness.processed.map(({ entryIds }) => entryIds)).toEqual([
      pending.slice(0, 50).map(({ entryId }) => entryId),
      [entryIdOf(51)],
    ]);
  });

  test('処理に失敗して返金待ちに残った枠を同じ呼び出しで処理し直さず、他の枠を処理してからその例外を投げる', async () => {
    const failure = new Error('Stripeが一時的に応答しない');
    const harness = createHarness(
      [pendingEntryOf(1), pendingEntryOf(2)],
      new Map([[entryIdOf(1), failure]]),
    );

    const result = followUpPendingEntries(
      harness.store,
      harness.followUp,
      TARGET,
      NOW,
    );

    expect(await result.catch((thrown: unknown) => thrown)).toBe(failure);
    expect(harness.processed).toEqual([
      { entryIds: [entryIdOf(1), entryIdOf(2)], now: NOW },
    ]);
    expect(harness.reads).toHaveLength(2);
  });

  test('複数の読み取りで処理に失敗したら、全ての読み取りを終えてから失敗をまとめて投げる', async () => {
    const pending = Array.from({ length: 51 }, (_, index) =>
      pendingEntryOf(index + 1),
    );
    const first = new Error('1件目の失敗');
    const last = new Error('51件目の失敗');
    const harness = createHarness(
      pending,
      new Map([
        [entryIdOf(1), first],
        [entryIdOf(51), last],
      ]),
    );

    const failure = await followUpPendingEntries(
      harness.store,
      harness.followUp,
      TARGET,
      NOW,
    ).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([first, last]);
    expect(harness.processed.map(({ entryIds }) => entryIds)).toEqual([
      pending.slice(0, 50).map(({ entryId }) => entryId),
      [entryIdOf(51)],
    ]);
  });
});
