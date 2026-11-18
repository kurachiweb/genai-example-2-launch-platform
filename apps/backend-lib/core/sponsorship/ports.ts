import type {
  SponsorshipExportStatus,
  SponsorshipState,
  SponsorshipStatus,
} from '../../../common-lib/sponsorship/sponsorship-status.ts';
import type { SponsorshipTier } from '../../../common-lib/sponsorship/sponsorship-tiers.ts';
import type { RefundRejectionOutcome } from '../payments/refund-rejection.ts';
import type { ProductSummaryRecord } from '../product/ports.ts';
import type { BusinessDate } from '../time/business-time.ts';

export type RefundKind = 'termination' | 'display_stop';

// requested以外はcore/paymentsのrefundRejectionOutcomeの返金の状態と同じ値
export type RefundStatus = 'requested' | RefundRejectionOutcome['refundStatus'];

export interface SponsorshipRefundRecord {
  // noneは未精算
  readonly status: 'none' | RefundStatus;
  readonly days: number | null;
  // 残りの全額で依頼したときはnull
  readonly amount: number | null;
  readonly refundRequestId: string | null;
}

export interface SponsorshipRecord {
  readonly id: string;
  readonly userId: string;
  readonly productId: string;
  readonly tier: SponsorshipTier;
  readonly startsOn: BusinessDate;
  readonly endsOn: BusinessDate;
  readonly days: number;
  readonly state: SponsorshipState;
  readonly purchaseId: string | null;
  readonly paymentRecordId: string | null;
  readonly amountTotal: number | null;
  readonly paidAt: Date | null;
  readonly terminatedAt: Date | null;
  readonly terminationReason: string | null;
  readonly productDeletedAt: Date | null;
  readonly terminationRefund: SponsorshipRefundRecord;
  readonly stopRefund: SponsorshipRefundRecord;
  readonly createdAt: Date;
}

export interface NewSponsorship {
  readonly userId: string;
  readonly productId: string;
  readonly tier: SponsorshipTier;
  readonly startsOn: BusinessDate;
  readonly endsOn: BusinessDate;
  readonly days: number;
}

export interface SponsorshipDatePeriodRecord {
  readonly startsOn: BusinessDate;
  readonly endsOn: BusinessDate;
}

// activeは表示停止中を含む。endedはプロダクトの論理削除が記録された決済済みを含み、scheduled・activeはそれを除く
export type AdminSponsorshipStatusFilter = Exclude<SponsorshipStatus, 'paused'>;

export interface AdminSponsorshipFilter {
  readonly status?: AdminSponsorshipStatusFilter;
  readonly tier?: SponsorshipTier;
}

export interface SponsorshipPageInput {
  // 呼び出し側が1〜50で渡す
  readonly first: number;
  // 前のページのendCursor
  readonly after?: string;
}

export interface SponsorshipPage {
  readonly records: readonly SponsorshipRecord[];
  readonly hasNextPage: boolean;
  // ページの最後の申込の位置。空のページはnull
  readonly endCursor: string | null;
}

export interface SponsorshipStore {
  create(input: NewSponsorship, at: Date): Promise<SponsorshipRecord>;
  // 論理削除済みはundefined
  findById(id: string): Promise<SponsorshipRecord | undefined>;
  // 決済済み(強制終了を除く)・論理削除なし・プロダクトの論理削除なしで1日でも重なる
  hasPaidOverlap(input: {
    readonly productId: string;
    readonly tier: SponsorshipTier;
    readonly startsOn: BusinessDate;
    readonly endsOn: BusinessDate;
    readonly excludeId?: string;
  }): Promise<boolean>;
  // hasPaidOverlapと同じ条件で、終了日がendsOnOrAfter以降の掲載期間を開始日の昇順で返す
  listPaidPeriods(input: {
    readonly productId: string;
    readonly tier: SponsorshipTier;
    readonly endsOnOrAfter: BusinessDate;
  }): Promise<readonly SponsorshipDatePeriodRecord[]>;
  // 論理削除なしを作成日時とIDの降順で。不正なカーソルはAppError(bad_request, 'invalid_cursor')
  listByOwner(
    userId: string,
    page: SponsorshipPageInput,
  ): Promise<SponsorshipPage>;
  // 退会者(論理削除済み)を除き、作成日時とIDの降順で。不正なカーソルはAppError(bad_request, 'invalid_cursor')
  listForAdmin(
    filter: AdminSponsorshipFilter,
    today: BusinessDate,
    page: SponsorshipPageInput,
  ): Promise<SponsorshipPage>;
  // 決済済み・論理削除なし・プロダクトの論理削除なし・終了日が今日以降
  countActiveForProduct(
    productId: string,
    today: BusinessDate,
  ): Promise<number>;
  // 未決済の行だけを消す
  deleteUnpaid(id: string): Promise<void>;
  // 開始日が今日より前の未決済を、開始日とIDの昇順に最大limit件消して件数を返す
  deleteExpiredUnpaid(today: BusinessDate, limit: number): Promise<number>;
  // 決済済み・論理削除なし・プロダクトの論理削除なし・終了日が今日より前・表示停止の返金が未精算を、終了日とIDの昇順で
  listUnsettledEnded(
    today: BusinessDate,
    limit: number,
  ): Promise<readonly SponsorshipRecord[]>;
}

export interface EligibleProduct {
  readonly productId: string;
  readonly handle: string;
  readonly name: string;
  readonly logoFileId: string;
}

export interface EligibleProductReader {
  // 名称の順
  list(userId: string, now: Date): Promise<readonly EligibleProduct[]>;
  isEligible(userId: string, productId: string, now: Date): Promise<boolean>;
}

export interface PlacedAd {
  readonly sponsorshipId: string;
  readonly tier: SponsorshipTier;
  readonly product: ProductSummaryRecord;
}

export interface PlacementReader {
  // ティアごとに無作為の順
  read(
    now: Date,
  ): Promise<Readonly<Record<SponsorshipTier, readonly PlacedAd[]>>>;
}

export interface SponsorshipExportRecord {
  readonly id: string;
  readonly product: { readonly name: string; readonly handle: string };
  readonly tier: SponsorshipTier;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly days: number;
  readonly status: SponsorshipExportStatus;
  readonly paymentId: string | null;
  readonly createdAt: Date;
}

export interface SponsorshipExport {
  // 論理削除済みを除き、申込の順
  listByUser(
    userId: string,
    now: Date,
  ): Promise<readonly SponsorshipExportRecord[]>;
}

export interface NoticeScheduler {
  // 開始(開始日が今日)と終了(終了日が今日より前で表示停止の返金を精算済み)の通知を、未依頼から依頼待ちにする2文を1回の一括の書き込みで実行する
  markDue(today: BusinessDate): Promise<void>;
  hasPending(): Promise<boolean>;
}

export interface NoticeRequester {
  // sponsorship.dispatch-noticesを1件送る。失敗は例外
  request(): Promise<void>;
  // sponsorship.settle-period-endを1件送る。失敗は例外
  requestSettlement(): Promise<void>;
}

export type DisplayStopSubject =
  | { readonly kind: 'product'; readonly productId: string }
  | { readonly kind: 'user'; readonly userId: string };

export interface DisplayStopInterval {
  readonly startedAt: Date;
  // 継続中はnull
  readonly endedAt: Date | null;
}

export interface DisplayStopStore {
  // プロダクトと投稿者の両方の区間のうち、[from, to)に重なるもの
  listOverlapping(input: {
    readonly productId: string;
    readonly userId: string;
    // 掲載開始日の0:00
    readonly from: Date;
    // 数え終わりの日の翌日0:00
    readonly to: Date;
  }): Promise<readonly DisplayStopInterval[]>;
  deleteSubject(subject: DisplayStopSubject): Promise<void>;
  // 終わりがcutoffより前の区間を最大limit件消して件数を返す
  deleteEndedBefore(cutoff: Date, limit: number): Promise<number>;
}

export interface RefundOutcome {
  readonly kind: RefundKind;
  readonly days: number;
  // 依頼した額(最小通貨単位)。残りの全額で依頼し直したときはnull
  readonly amount: number | null;
  readonly status: RefundStatus;
  readonly refundRequestId: string | null;
}

export interface TerminationEstimate {
  readonly unexposedDays: number;
  readonly refundEstimate: number;
  readonly stoppedDays: number;
  readonly stopRefundAmount: number;
}

export interface RefundEstimator {
  // 強制終了の照会用。決済の機能を呼ばない
  estimateTermination(
    record: SponsorshipRecord,
    today: BusinessDate,
  ): Promise<TerminationEstimate>;
}

// 決済の返金の依頼の理由と、依頼キー(sponsorship:<購入ID>:<理由>)の末尾
export const SPONSORSHIP_REFUND_REASONS = Object.freeze({
  termination: 'sponsorship_terminated',
  displayStop: 'sponsorship_display_stopped',
} as const);
