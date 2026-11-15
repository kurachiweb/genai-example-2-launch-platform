import type { UltrasPlanStatus } from '../../../common-lib/ultras/plan-status.ts';
import type { SubscriptionSnapshot } from './entitlement-rules.ts';

export type UltrasNoticeKind = 'payment_failed' | 'cancellation_accepted';

export type UltrasNoticeStatus = 'pending' | 'requested' | 'skipped';

export interface SubscriptionRow extends SubscriptionSnapshot {
  readonly id: string;
  readonly stripeSubscriptionId: string;
  readonly userId: string;
  readonly purchaseId: string | null;
}

export interface UltrasActivationRow {
  readonly id: string;
  readonly userId: string;
  readonly stripeSubscriptionId: string;
  readonly activatedAt: Date;
  readonly dispatchedAt: Date | null;
  readonly completedAt: Date | null;
  readonly createdAt: Date;
}

export interface UltrasNoticeRow {
  readonly id: string;
  readonly userId: string;
  readonly stripeSubscriptionId: string;
  readonly kind: UltrasNoticeKind;
  readonly dedupeKey: string;
  readonly payload: Readonly<Record<string, string>>;
  readonly status: UltrasNoticeStatus;
  readonly finishedAt: Date | null;
  readonly createdAt: Date;
}

export interface SubscriptionStore {
  findByStripeId(
    stripeSubscriptionId: string,
  ): Promise<SubscriptionRow | undefined>;
  findEntitledOverlapping(input: {
    readonly userId: string;
    readonly at: Date;
    readonly excludeStripeId?: string;
  }): Promise<SubscriptionRow | undefined>;
  // 利用者は90件ずつに分けて問い合わせる
  findOverlapping(input: {
    readonly userIds: readonly string[];
    readonly from: Date;
    readonly to: Date;
  }): Promise<
    readonly Pick<SubscriptionRow, 'userId' | 'startedAt' | 'benefitEndsAt'>[]
  >;
  // started_atの降順の先頭
  findLatestActivated(userId: string): Promise<SubscriptionRow | undefined>;
  // 終了していないStripe側の状態の行
  findCancellable(userId: string): Promise<readonly SubscriptionRow[]>;
  markPendingCancellation(input: {
    readonly id: string;
    readonly source: 'suspension' | 'withdrawal';
  }): Promise<void>;
}

export interface ActivationStore {
  findById(id: string): Promise<UltrasActivationRow | undefined>;
  findByStripeId(
    stripeSubscriptionId: string,
  ): Promise<UltrasActivationRow | undefined>;
  markDispatched(id: string, at: Date): Promise<void>;
  markCompleted(id: string, at: Date): Promise<void>;
  findUndispatched(input: {
    readonly createdBefore: Date;
    readonly redispatchBefore: Date;
    readonly limit: number;
  }): Promise<readonly UltrasActivationRow[]>;
  // 消した件数を返す
  deleteCompletedBefore(threshold: Date, limit: number): Promise<number>;
}

export interface NoticeStore {
  findPendingBySubscription(
    stripeSubscriptionId: string,
  ): Promise<readonly UltrasNoticeRow[]>;
  findPendingBefore(
    threshold: Date,
    limit: number,
  ): Promise<readonly UltrasNoticeRow[]>;
  // 依頼待ちのときだけ進める
  markRequested(id: string, at: Date): Promise<'updated' | 'not_pending'>;
  markSkipped(id: string, at: Date): Promise<void>;
  // 消した件数を返す
  deleteFinishedBefore(threshold: Date, limit: number): Promise<number>;
}

export interface UltrasPromotionFlagReader {
  // 行が無ければULTRAS_PROMOTION_FLAG_DEFAULT
  isEnabled(): Promise<boolean>;
}

export interface UltrasPlanView {
  readonly status: UltrasPlanStatus;
  readonly startedAt: Date;
  readonly currentPeriodEndsAt: Date | null;
  readonly benefitEndsAt: Date | null;
  readonly canceledAt: Date | null;
}

// 判定はstarted_atとbenefit_ends_atだけを使い、機能フラグを読まない
export interface UltrasEntitlements {
  isEntitledAt(userId: string, at: Date): Promise<boolean>;
  // 両端を含む期間との重なり
  wasEntitledDuring(userId: string, from: Date, to: Date): Promise<boolean>;
  entitledUsersAt(
    userIds: readonly string[],
    at: Date,
  ): Promise<ReadonlySet<string>>;
  entitledUsersDuring(
    userIds: readonly string[],
    from: Date,
    to: Date,
  ): Promise<ReadonlySet<string>>;
  // 最新の有効化された加入。無ければnull
  currentPlan(userId: string, now: Date): Promise<UltrasPlanView | null>;
}

export interface UltrasPlanExportItem {
  readonly name: 'ultras';
  readonly status: UltrasPlanStatus;
  readonly startedAt: Date;
  readonly currentPeriodEndsAt: Date | null;
  readonly canceledAt: Date | null;
}

export interface UltrasPlanExport {
  find(userId: string, now: Date): Promise<UltrasPlanExportItem | null>;
}

export interface ActivationDispatcher {
  // 送り出しの失敗はwarnのログだけにし、日次の確認が送り直す
  dispatch(activationId: string): Promise<void>;
}

export interface UltrasNotifier {
  sendPendingFor(stripeSubscriptionId: string): Promise<void>;
  // requestedは依頼を記録した、skippedは宛先が無く対象外として記録した、not_pendingは依頼待ちでない
  send(
    notice: UltrasNoticeRow,
  ): Promise<'requested' | 'skipped' | 'not_pending'>;
}
