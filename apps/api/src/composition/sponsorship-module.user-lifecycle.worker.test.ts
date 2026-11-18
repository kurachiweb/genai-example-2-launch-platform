import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { paymentRefunds } from '../../db/schema/payments/payment-refunds.ts';
import { SPONSORSHIP_PLATFORM_TYPES } from '../../lib/core/sponsorship/identifiers.ts';
import type {
  PlacementReader,
  SponsorshipRecord,
  SponsorshipStore,
} from '../../lib/core/sponsorship/ports.ts';
import { parseBusinessDate } from '../../lib/core/time/business-time.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import type { RefundSettlement } from '../../lib/workers/sponsorship/refund-settlement.ts';
import {
  db,
  insertDisplayStops,
  insertSponsorshipPurchase,
  NOW,
  productIdOf,
  sponsorshipIdOf,
  TODAY,
  userIdOf,
} from '../../lib/workers/sponsorship/testing/sponsorship-fixtures.ts';
import { IDENTITY_TYPES } from '../application/identity/identity-types.ts';
import type {
  UserLifecycleCommitter,
  UserStateTransition,
} from '../application/identity/ports.ts';
import { SPONSORSHIP_TYPES } from '../application/sponsorship/sponsorship-types.ts';
import type { UserLifecycleSyncHandler } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';
import { AccountWithdrawalSyncHandler } from '../infrastructure/sponsorship/account-withdrawal-sync-handler.ts';
import {
  AT,
  CLOSURE_SPONSORSHIPS,
  LATER,
  OTHER_OWNER,
  OWNER,
  readClosureState,
  seedClosureScenario,
  TARGET_PRODUCT,
  untouchedState,
  withdrawnState,
} from '../infrastructure/sponsorship/testing/closure-fixtures.ts';
import { MODULES } from './modules.ts';
import { USER_LIFECYCLE_SYNC_HANDLERS } from './user-lifecycle-sync-handlers.ts';

const BUSINESS_TODAY = parseBusinessDate(TODAY);

const PAGE = Object.freeze({ first: 50 });

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

function storeOf(container: Container = createContainer()): SponsorshipStore {
  return container.get<SponsorshipStore>(
    SPONSORSHIP_PLATFORM_TYPES.SponsorshipStore,
  );
}

async function commit(
  kind: UserStateTransition['kind'],
  options: { readonly expectedVersion?: number; readonly at?: Date } = {},
): Promise<void> {
  await createContainer()
    .get<UserLifecycleCommitter>(IDENTITY_TYPES.UserLifecycleCommitter)
    .commit({
      kind,
      userId: userIdOf(OWNER),
      expectedVersion: options.expectedVersion ?? 0,
      at: options.at ?? AT,
    });
}

async function placedIds(): Promise<string[]> {
  const placements = await createContainer()
    .get<PlacementReader>(SPONSORSHIP_PLATFORM_TYPES.PlacementReader)
    .read(NOW);
  return [...placements.legend, ...placements.gold, ...placements.silver]
    .map(({ sponsorshipId }) => sponsorshipId)
    .toSorted();
}

async function ownListIds(owner: number): Promise<string[]> {
  const page = await storeOf().listByOwner(userIdOf(owner), PAGE);
  return page.records.map(({ id }) => id);
}

async function adminListIds(): Promise<string[]> {
  const page = await storeOf().listForAdmin({}, BUSINESS_TODAY, PAGE);
  return page.records.map(({ id }) => id).toSorted();
}

async function unsettledEndedIds(): Promise<string[]> {
  const records = await storeOf().listUnsettledEnded(BUSINESS_TODAY, 50);
  return records.map(({ id }) => id);
}

async function readRecord(index: number): Promise<SponsorshipRecord> {
  const record = await storeOf().findById(sponsorshipIdOf(index));
  if (record === undefined) {
    throw new Error('申込が見つからない');
  }
  return record;
}

function idsOf(indexes: readonly number[]): string[] {
  return indexes.map(sponsorshipIdOf).toSorted();
}

const ALL_INDEXES = Object.values(CLOSURE_SPONSORSHIPS);

beforeEach(seedClosureScenario);

describe('APIサーバーのスポンサー広告のモジュールのユーザーの同期の処理の束縛', () => {
  test('退会の同期の処理を、退会だけを対象にユーザーの同期の処理の登録口に1つ登録する', () => {
    expect(
      USER_LIFECYCLE_SYNC_HANDLERS.filter(
        ({ name, handler }) =>
          name === 'sponsorship.account-withdrawal' ||
          handler === SPONSORSHIP_TYPES.AccountWithdrawalSyncHandler,
      ),
    ).toStrictEqual([
      {
        name: 'sponsorship.account-withdrawal',
        events: ['withdrawn'],
        handler: SPONSORSHIP_TYPES.AccountWithdrawalSyncHandler,
      },
    ]);
  });

  test('処理単位のコンテナから、退会の同期の処理を実装に解決する', () => {
    expect(
      createContainer().get<UserLifecycleSyncHandler>(
        SPONSORSHIP_TYPES.AccountWithdrawalSyncHandler,
      ),
    ).toBeInstanceOf(AccountWithdrawalSyncHandler);
  });
});

describe('退会の同期の処理の登録', () => {
  test('退会の確定と同じ一括の書き込みで、退会した利用者の全ての申込を論理削除し、未精算の表示停止の返金を返金不要にする', async () => {
    await commit('withdraw');

    await expect(readClosureState()).resolves.toEqual(withdrawnState(AT));
  });

  test('退会した利用者の申込は、表示・自分の一覧・管理画面の一覧・掲載の終わりの精算の対象から消え、他の利用者の申込は残る', async () => {
    await expect(placedIds()).resolves.toEqual(
      idsOf([
        CLOSURE_SPONSORSHIPS.active,
        CLOSURE_SPONSORSHIPS.sibling,
        CLOSURE_SPONSORSHIPS.other,
      ]),
    );
    await expect(ownListIds(OWNER)).resolves.toHaveLength(6);
    await expect(adminListIds()).resolves.toEqual(idsOf(ALL_INDEXES));
    await expect(unsettledEndedIds()).resolves.toEqual(
      idsOf([CLOSURE_SPONSORSHIPS.endedUnsettled]),
    );

    await commit('withdraw');

    await expect(placedIds()).resolves.toEqual(
      idsOf([CLOSURE_SPONSORSHIPS.other]),
    );
    await expect(ownListIds(OWNER)).resolves.toEqual([]);
    await expect(ownListIds(OTHER_OWNER)).resolves.toEqual(
      idsOf([CLOSURE_SPONSORSHIPS.other]),
    );
    await expect(adminListIds()).resolves.toEqual(
      idsOf([CLOSURE_SPONSORSHIPS.other]),
    );
    await expect(unsettledEndedIds()).resolves.toEqual([]);
  });

  test('退会の前に読んだ申込の掲載の終わりの精算は、退会の後に確定すると表示停止の返金の依頼ごと取り消される', async () => {
    await insertSponsorshipPurchase({
      index: CLOSURE_SPONSORSHIPS.endedUnsettled,
      owner: OWNER,
    });
    // 11-12 10:00から11-14 0:00ちょうどまで(11-12・11-13の2日)
    await insertDisplayStops([
      {
        index: 1,
        subject: { kind: 'product', productId: productIdOf(TARGET_PRODUCT) },
        startedAt: new Date('2026-11-12T18:00:00.000Z'),
        endedAt: new Date('2026-11-14T08:00:00.000Z'),
      },
    ]);
    const container = createContainer();
    const settlement = container.get<RefundSettlement>(
      SPONSORSHIP_PLATFORM_TYPES.RefundSettlement,
    );
    const record = await readRecord(CLOSURE_SPONSORSHIPS.endedUnsettled);
    const plan = await settlement.planPeriodEnd(record);
    expect(plan).toMatchObject({ status: 'requested', days: 2 });

    await commit('withdraw');

    await expect(
      db.batch([
        settlement.periodEndStatement(record, plan, LATER, db),
        ...plan.statements,
      ]),
    ).rejects.toThrow();
    await expect(db.select().from(paymentRefunds)).resolves.toEqual([]);
    await expect(readClosureState()).resolves.toEqual(withdrawnState(AT));
  });

  test('読み取った版が古い退会は確定せず、申込の論理削除と返金不要の記録も取り消される', async () => {
    await expect(
      commit('withdraw', { expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'account_state_conflict' });

    await expect(readClosureState()).resolves.toEqual(untouchedState());
  });
});

describe('停止と停止の解除', () => {
  test('停止と停止の解除では、申込の論理削除と返金不要の記録をしない', async () => {
    await commit('suspend');
    await commit('unsuspend', { expectedVersion: 1, at: LATER });

    await expect(readClosureState()).resolves.toEqual(untouchedState());
  });
});
