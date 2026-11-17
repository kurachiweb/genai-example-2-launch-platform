import { describe, expect, test } from 'bun:test';

import type { ProductLifecycleEvent } from '../../../lib/core/product/product-lifecycle.ts';
import type { BracketStore } from '../../../lib/core/tournament/ports.ts';
import type { WeekTournamentStore } from '../../../lib/core/week-tournament/ports.ts';
import { EntryUnlinkHandler } from './entry-unlink-handler.ts';

const PRODUCT_ID = '01JD0PR0D00000000000000001';

const EVENT: ProductLifecycleEvent = Object.freeze({
  id: '01JD0PEVT00000000000000001',
  productId: PRODUCT_ID,
  ownerUserId: '01JD0USER00000000000000001',
  type: 'purge_due',
  occurredAt: new Date('2026-12-20T09:00:00.000Z'),
});

function notUsed(): never {
  throw new Error('物理削除の紐付けの解除の処理はこの操作を使わない');
}

type Call =
  | { readonly kind: 'unlinkEntries'; readonly productId: string }
  | { readonly kind: 'unlinkParticipants'; readonly productId: string };

interface Harness {
  readonly handler: EntryUnlinkHandler;
  readonly calls: Call[];
}

function createHarness(failure?: {
  readonly on: Call['kind'];
  readonly error: Error;
}): Harness {
  const calls: Call[] = [];
  const settle = <T>(call: Call, value: T): Promise<T> => {
    calls.push(call);
    return failure?.on === call.kind
      ? Promise.reject(failure.error)
      : Promise.resolve(value);
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
    listPendingFollowUpsOf: notUsed,
    markRefundRequested: notUsed,
    markRefundClosed: notUsed,
    markNotice: notUsed,
    unlinkOrDeleteByProduct: (productId) =>
      settle({ kind: 'unlinkEntries', productId }, { unlinked: 1, deleted: 2 }),
  };
  const brackets: BracketStore = {
    findByTournament: notUsed,
    findById: notUsed,
    findByMatchIds: notUsed,
    findAliveRefs: notUsed,
    unlinkProduct: (productId) =>
      settle({ kind: 'unlinkParticipants', productId }, 1),
  };
  return { handler: new EntryUnlinkHandler(store, brackets), calls };
}

describe('EntryUnlinkHandler', () => {
  test('物理削除の時期に、プロダクトの枠の紐付けの解除と削除、ブラケットの参加者の紐付けの解除を行って完了を返す', async () => {
    const { handler, calls } = createHarness();

    const outcome = await handler.handle(EVENT);

    expect(outcome).toEqual({ kind: 'done' });
    expect(calls).toEqual([
      { kind: 'unlinkEntries', productId: PRODUCT_ID },
      { kind: 'unlinkParticipants', productId: PRODUCT_ID },
    ]);
  });

  test.each(['unlinkEntries', 'unlinkParticipants'] as const)(
    '%sの失敗はそのまま投げ、イベントの再試行に任せる',
    async (on) => {
      const error = new Error('D1が一時的に応答しない');
      const { handler } = createHarness({ on, error });

      const caught = await handler
        .handle(EVENT)
        .catch((thrown: unknown) => thrown);

      expect(caught).toBe(error);
    },
  );
});
