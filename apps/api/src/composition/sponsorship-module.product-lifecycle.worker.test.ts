import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { SPONSORSHIP_TERMINATE_ACTION } from '../../common-lib/admin/audit-actions/sponsorship.ts';
import { paymentRefunds } from '../../db/schema/payments/payment-refunds.ts';
import type { SyncProductLifecycleEventType } from '../../lib/core/product/product-lifecycle.ts';
import { SPONSORSHIP_PLATFORM_TYPES } from '../../lib/core/sponsorship/identifiers.ts';
import type {
  AdminSponsorshipStatusFilter,
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
} from '../../lib/workers/sponsorship/testing/sponsorship-fixtures.ts';
import type { ProductLifecycleCommitter } from '../application/product/ports.ts';
import { PRODUCT_TYPES } from '../application/product/product-types.ts';
import type { SponsorshipTerminationWriter } from '../application/sponsorship/sponsorship-termination.ts';
import { SPONSORSHIP_TYPES } from '../application/sponsorship/sponsorship-types.ts';
import {
  adminIdOf,
  clearAdminTables,
  createAuditLogRecorder,
  createSequentialAuditLogIds,
  readAuditLogSummaries,
} from '../infrastructure/admin/testing/admin-store-fixtures.ts';
import type { ProductLifecycleSyncHandler } from '../infrastructure/product/product-lifecycle-sync-handler.ts';
import { ProductDeletionSyncHandler } from '../infrastructure/sponsorship/product-deletion-sync-handler.ts';
import {
  AT,
  CLOSURE_SPONSORSHIPS,
  LATER,
  OWNER,
  productDeletedState,
  readClosureState,
  seedClosureScenario,
  SIBLING_PRODUCT,
  TARGET_PRODUCT,
  untouchedState,
} from '../infrastructure/sponsorship/testing/closure-fixtures.ts';
import { MODULES } from './modules.ts';
import { PRODUCT_LIFECYCLE_SYNC_HANDLERS } from './product-lifecycle-sync-handlers.ts';

const BUSINESS_TODAY = parseBusinessDate(TODAY);

const PAGE = Object.freeze({ first: 50 });

const REASON = '規約に反する広告のため';

const TARGET_PRODUCT_INDEXES = [
  CLOSURE_SPONSORSHIPS.active,
  CLOSURE_SPONSORSHIPS.endedUnsettled,
  CLOSURE_SPONSORSHIPS.scheduled,
  CLOSURE_SPONSORSHIPS.endedSettled,
];

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

function storeOf(): SponsorshipStore {
  return createContainer().get<SponsorshipStore>(
    SPONSORSHIP_PLATFORM_TYPES.SponsorshipStore,
  );
}

function commit(
  type: SyncProductLifecycleEventType,
  options: { readonly expectedVersion?: number; readonly at?: Date } = {},
) {
  return createContainer()
    .get<ProductLifecycleCommitter>(PRODUCT_TYPES.ProductLifecycleCommitter)
    .commit({
      type,
      productId: productIdOf(TARGET_PRODUCT),
      ...(options.expectedVersion === undefined
        ? {}
        : { expectedVersion: options.expectedVersion }),
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

async function adminListIds(
  status: AdminSponsorshipStatusFilter,
): Promise<string[]> {
  const page = await storeOf().listForAdmin({ status }, BUSINESS_TODAY, PAGE);
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

// 11-12 10:00から11-14 0:00ちょうどまで(11-12・11-13の2日)。掲載中の申込は11-20からのため数えない
async function insertTargetDisplayStop(): Promise<void> {
  await insertDisplayStops([
    {
      index: 1,
      subject: { kind: 'product', productId: productIdOf(TARGET_PRODUCT) },
      startedAt: new Date('2026-11-12T18:00:00.000Z'),
      endedAt: new Date('2026-11-14T08:00:00.000Z'),
    },
  ]);
}

beforeEach(async () => {
  await seedClosureScenario();
  await clearAdminTables();
});

describe('APIサーバーのスポンサー広告のモジュールのプロダクトの同期の処理の束縛', () => {
  test('プロダクトの論理削除の同期の処理を、削除だけを対象にプロダクトの同期の処理の登録口に1つ登録する', () => {
    expect(
      PRODUCT_LIFECYCLE_SYNC_HANDLERS.filter(
        ({ name, handler }) =>
          name === 'sponsorship.product-deletion' ||
          handler === SPONSORSHIP_TYPES.ProductDeletionSyncHandler,
      ),
    ).toStrictEqual([
      {
        name: 'sponsorship.product-deletion',
        events: ['deleted'],
        handler: SPONSORSHIP_TYPES.ProductDeletionSyncHandler,
      },
    ]);
  });

  test('処理単位のコンテナから、プロダクトの論理削除の同期の処理を実装に解決する', () => {
    expect(
      createContainer().get<ProductLifecycleSyncHandler>(
        SPONSORSHIP_TYPES.ProductDeletionSyncHandler,
      ),
    ).toBeInstanceOf(ProductDeletionSyncHandler);
  });
});

describe('削除の同期の処理の登録', () => {
  test('削除の確定と同じ一括の書き込みで、そのプロダクトの全ての申込に削除の日時を記録し、未精算の表示停止の返金を返金不要にする', async () => {
    await expect(commit('deleted')).resolves.toMatchObject({
      kind: 'committed',
    });

    await expect(readClosureState()).resolves.toEqual(productDeletedState(AT));
  });

  test('削除したプロダクトの決済済みの申込は管理画面の「終了」の絞り込みに入り、掲載予定・掲載中・表示・削除の確認の件数・掲載の終わりの精算の対象から外れる', async () => {
    await expect(
      storeOf().countActiveForProduct(
        productIdOf(TARGET_PRODUCT),
        BUSINESS_TODAY,
      ),
    ).resolves.toBe(2);
    await expect(unsettledEndedIds()).resolves.toEqual(
      idsOf([CLOSURE_SPONSORSHIPS.endedUnsettled]),
    );

    await commit('deleted');

    await expect(adminListIds('ended')).resolves.toEqual(
      idsOf(TARGET_PRODUCT_INDEXES),
    );
    await expect(adminListIds('scheduled')).resolves.toEqual([]);
    await expect(adminListIds('active')).resolves.toEqual(
      idsOf([CLOSURE_SPONSORSHIPS.sibling, CLOSURE_SPONSORSHIPS.other]),
    );
    await expect(placedIds()).resolves.toEqual(
      idsOf([CLOSURE_SPONSORSHIPS.sibling, CLOSURE_SPONSORSHIPS.other]),
    );
    await expect(
      storeOf().countActiveForProduct(
        productIdOf(TARGET_PRODUCT),
        BUSINESS_TODAY,
      ),
    ).resolves.toBe(0);
    await expect(
      storeOf().countActiveForProduct(
        productIdOf(SIBLING_PRODUCT),
        BUSINESS_TODAY,
      ),
    ).resolves.toBe(1);
    await expect(unsettledEndedIds()).resolves.toEqual([]);
  });

  test('削除の前に読んだ掲載中の申込は、削除の後に強制終了を確定しようとしても強制終了できず、返金の依頼と監査ログも残らない', async () => {
    await insertSponsorshipPurchase({
      index: CLOSURE_SPONSORSHIPS.active,
      owner: OWNER,
    });
    const record = await readRecord(CLOSURE_SPONSORSHIPS.active);

    await commit('deleted');

    const writer = createContainer().get<SponsorshipTerminationWriter>(
      SPONSORSHIP_TYPES.SponsorshipTerminationWriter,
    );
    await expect(
      writer.commit({
        record,
        today: BUSINESS_TODAY,
        reason: REASON,
        at: LATER,
        audit: createAuditLogRecorder({
          ids: createSequentialAuditLogIds(),
        }).prepare({
          operatorAdminId: adminIdOf(1),
          action: SPONSORSHIP_TERMINATE_ACTION.name,
          targetIds: [record.id],
          reason: REASON,
          detail: {
            unexposedDays: '5',
            refundEstimate: '3500',
            stoppedDays: '0',
            stopRefundAmount: '0',
          },
          occurredAt: LATER,
        }),
      }),
    ).resolves.toEqual({ kind: 'not_terminable' });
    await expect(readClosureState()).resolves.toEqual(productDeletedState(AT));
    await expect(db.select().from(paymentRefunds)).resolves.toEqual([]);
    await expect(readAuditLogSummaries()).resolves.toEqual([]);
  });

  test('削除の前に読んだ申込の掲載の終わりの精算は、削除の後に確定すると表示停止の返金の依頼ごと取り消される', async () => {
    await insertSponsorshipPurchase({
      index: CLOSURE_SPONSORSHIPS.endedUnsettled,
      owner: OWNER,
    });
    await insertTargetDisplayStop();
    const settlement = createContainer().get<RefundSettlement>(
      SPONSORSHIP_PLATFORM_TYPES.RefundSettlement,
    );
    const record = await readRecord(CLOSURE_SPONSORSHIPS.endedUnsettled);
    const plan = await settlement.planPeriodEnd(record);
    expect(plan).toMatchObject({ status: 'requested', days: 2 });

    await commit('deleted');

    await expect(
      db.batch([
        settlement.periodEndStatement(record, plan, LATER, db),
        ...plan.statements,
      ]),
    ).rejects.toThrow();
    await expect(db.select().from(paymentRefunds)).resolves.toEqual([]);
    await expect(readClosureState()).resolves.toEqual(productDeletedState(AT));
  });

  test('読み取った版が古い削除は確定せず、申込への削除の日時と返金不要の記録も取り消される', async () => {
    await expect(commit('deleted', { expectedVersion: 1 })).resolves.toEqual({
      kind: 'rejected',
      reason: 'conflict',
    });

    await expect(readClosureState()).resolves.toEqual(untouchedState());
  });
});

describe('非公開化と復元', () => {
  test('非公開化と復元では、申込に削除の日時と返金不要を記録しない', async () => {
    await commit('hidden');
    await commit('unhidden', { at: LATER });

    await expect(readClosureState()).resolves.toEqual(untouchedState());
  });
});
