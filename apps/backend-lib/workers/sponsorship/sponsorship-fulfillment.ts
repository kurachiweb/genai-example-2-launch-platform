import type { Logger } from '@logtape/logtape';
import { and, eq, gte, isNull, lte, ne, notExists, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { alias } from 'drizzle-orm/sqlite-core';

import type { Database } from '../../../db/client.ts';
import { sponsorships } from '../../../db/schema/sponsorship/sponsorships.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import type { FulfillablePurchase } from '../../core/payments/purchase-kind-contract.ts';
import type {
  EligibleProductReader,
  NoticeRequester,
  SponsorshipRecord,
  SponsorshipStore,
} from '../../core/sponsorship/ports.ts';
import {
  addBusinessDays,
  type BusinessDate,
  fromBusinessDateTime,
} from '../../core/time/business-time.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import type {
  FulfillmentPlan,
  PurchaseFulfillment,
} from '../payments/fulfillment-contract.ts';
import { payabilityRejectionOf } from './sponsorship-payability.ts';

export interface SponsorshipFulfillmentDependencies {
  readonly appName: LoggingOptions['appName'];
  readonly store: SponsorshipStore;
  readonly eligibleProducts: EligibleProductReader;
  readonly notices: NoticeRequester;
}

const REJECTED: FulfillmentPlan = Object.freeze({
  kind: 'reject',
  reason: 'ineligible',
});

const START_OF_DAY = Object.freeze({ hour: 0, minute: 0 });

// 開始通知を依頼待ちにする日次のジョブの時刻
const START_NOTICE_JOB_TIME = Object.freeze({ hour: 0, minute: 7 });

// 外側の文がsponsorshipsを対象にしても列の参照が副問い合わせの側に取られないよう、別名で読む
const other = alias(sponsorships, 'other_sponsorship');

// 開始日の0:07のジョブより前の確定はジョブが開始通知を依頼待ちにするため、ジョブの後の開始日の確定だけをここで依頼待ちにする
function startNoticeOf(
  startsOn: BusinessDate,
  paidAt: Date,
): 'pending' | 'none' {
  const jobAt = fromBusinessDateTime(startsOn, START_NOTICE_JOB_TIME);
  const nextDay = fromBusinessDateTime(
    addBusinessDays(startsOn, 1),
    START_OF_DAY,
  );
  return jobAt <= paidAt && paidAt < nextDay ? 'pending' : 'none';
}

// 判定から確定までの間に申込が論理削除されるか重なる申込が決済済みになると、状態がNULLになりNOT NULL制約の違反で一括の書き込み全体が取り消される。決済の機能はprepareを呼び直して拒否する
function paidStatement(
  db: Database,
  record: SponsorshipRecord,
  purchase: FulfillablePurchase,
): BatchItem<'sqlite'> {
  const overlappingPaid = db
    .select({ id: other.id })
    .from(other)
    .where(
      and(
        eq(other.productId, sponsorships.productId),
        eq(other.tier, sponsorships.tier),
        eq(other.state, 'paid'),
        isNull(other.deletedAt),
        isNull(other.productDeletedAt),
        ne(other.id, sponsorships.id),
        lte(other.startsOn, sponsorships.endsOn),
        gte(other.endsOn, sponsorships.startsOn),
      ),
    );
  const stillPayable = and(
    eq(sponsorships.state, 'pending_payment'),
    isNull(sponsorships.deletedAt),
    notExists(overlappingPaid),
  );
  return db
    .update(sponsorships)
    .set({
      state: sql<'paid'>`case when ${stillPayable} then 'paid' else null end`,
      purchaseId: purchase.purchaseId,
      paymentRecordId: purchase.paymentRecordId,
      amountTotal: purchase.amountTotal,
      paidAt: purchase.paidAt,
      startNotice: startNoticeOf(record.startsOn, purchase.paidAt),
      updatedAt: purchase.paidAt,
    })
    .where(eq(sponsorships.id, record.id));
}

export class SponsorshipFulfillment implements PurchaseFulfillment {
  private readonly store: SponsorshipStore;
  private readonly eligibleProducts: EligibleProductReader;
  private readonly notices: NoticeRequester;
  private readonly logger: Logger;

  constructor(dependencies: SponsorshipFulfillmentDependencies) {
    this.store = dependencies.store;
    this.eligibleProducts = dependencies.eligibleProducts;
    this.notices = dependencies.notices;
    this.logger = getAppLogger([
      dependencies.appName,
      'sponsorship',
      'fulfillment',
    ]);
  }

  // 決済の機能は反映の時刻を支払いの時刻(paidAt)として渡すため、paidAtの時点で判定する
  async prepare(
    purchase: FulfillablePurchase,
    db: Database,
  ): Promise<FulfillmentPlan> {
    const record = await this.ownSponsorshipOf(purchase);
    if (record === undefined) {
      return REJECTED;
    }
    // 決済済みの申込への2回目の決済は拒否せずに文を返し、文の失敗から決済の機能に二重決済として扱わせる
    if (
      record.state === 'pending_payment' &&
      (await payabilityRejectionOf(record, purchase.paidAt, {
        store: this.store,
        eligibleProducts: this.eligibleProducts,
      })) !== undefined
    ) {
      return REJECTED;
    }
    return {
      kind: 'fulfill',
      statements: [paidStatement(db, record, purchase)],
    };
  }

  // 送信の依頼に失敗しても依頼待ちの行が残り、4:21のジョブが送り直す
  async afterCommit(purchase: FulfillablePurchase): Promise<void> {
    const record = await this.ownSponsorshipOf(purchase);
    if (
      record?.purchaseId !== purchase.purchaseId ||
      startNoticeOf(record.startsOn, purchase.paidAt) !== 'pending'
    ) {
      return;
    }
    try {
      await this.notices.request();
    } catch (error) {
      this.logger.warn('掲載開始通知の送信を依頼できませんでした', {
        error,
        purchaseId: purchase.purchaseId,
        sponsorshipId: record.id,
      });
    }
  }

  private async ownSponsorshipOf(
    purchase: FulfillablePurchase,
  ): Promise<SponsorshipRecord | undefined> {
    if (purchase.targetId === null) {
      return undefined;
    }
    const record = await this.store.findById(purchase.targetId);
    return record?.userId === purchase.userId ? record : undefined;
  }
}
