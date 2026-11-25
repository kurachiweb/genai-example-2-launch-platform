import type { BusinessDate } from '../time/business-time.ts';
import type { AdvanceResult } from '../tournament/ports.ts';
import type {
  YearEntitlementSource,
  YearEntryCloseReason,
  YearEntryStatus,
  YearRefundNoticeStatus,
  YearRefundStatus,
} from './year-entry-rules.ts';
import type { YearSchedule } from './year-schedule.ts';
import type {
  TargetYearResolution,
  YearCalendarYear,
} from './year-target-rules.ts';

export type YearTournamentStatus =
  'open' | 'drawing' | 'in_progress' | 'finished';

export type YearFinalDateSource = 'explicit' | 'default';

export interface YearTournamentRecord {
  readonly yearTournamentId: string;
  readonly year: number;
  // 行の作成時と決勝日の保存時に求めて保存した期限。判定は求め直さずにこの値を使う
  readonly schedule: YearSchedule;
  readonly source: YearFinalDateSource;
  // 決勝日の版(0は未設定)
  readonly version: number;
  // 決勝日を保存した日時と管理者
  readonly updatedAt: Date | null;
  readonly updatedByAdminId: string | null;
  readonly status: YearTournamentStatus;
  // 凍結の日時。凍結の後は資格を変える書き込みが何もしない
  readonly drawStartedAt: Date | null;
  readonly bracketId: string | null;
  readonly firstRoundDate: BusinessDate | null;
  readonly participantCount: number | null;
  readonly outcome: 'awarded' | 'no_award' | null;
  readonly championEntryId: string | null;
  readonly awardedAt: Date | null;
}

export type YearTournamentFinish =
  | { readonly outcome: 'awarded'; readonly championEntryId: string }
  | { readonly outcome: 'no_award'; readonly championEntryId: null };

export interface YearDrawRecord {
  readonly bracketId: string;
  // 参加0・1で1回戦の無い年はnull
  readonly firstRoundDate: BusinessDate | null;
  readonly participantCount: number;
  // 参加0・1で組み合わせと同時に終わる年だけ結果を渡す
  readonly finished: YearTournamentFinish | null;
}

export interface YearAwardedProduct {
  readonly yearTournamentId: string;
  readonly year: number;
  readonly productId: string;
}

export interface YearProductAward {
  readonly productId: string;
  readonly launchId: string;
  readonly year: number;
  readonly awardedAt: Date;
}

export interface YearTournamentStore {
  // 年の一意索引で重複を無視して既定の日の列で作り、既にあれば保存した記録を返す
  ensureYear(
    year: number,
    schedule: YearSchedule,
    at: Date,
  ): Promise<YearTournamentRecord>;
  // 行の無い年は結果に含めない
  findByYears(
    years: readonly number[],
  ): Promise<ReadonlyMap<number, YearTournamentRecord>>;
  findById(yearTournamentId: string): Promise<YearTournamentRecord | undefined>;
  // 組み合わせ決定の日時が到来した受付中・組み合わせ決定中の年を、年の昇順で返す
  listDue(now: Date, limit: number): Promise<readonly YearTournamentRecord[]>;
  // 進行中の年を年の昇順で返す
  listInProgress(limit: number): Promise<readonly YearTournamentRecord[]>;
  // 凍結済みの年の決済期限日の最大。凍結済みの年が無ければnull
  latestFrozenDeadlineDate(): Promise<BusinessDate | null>;
  // 凍結前の年だけに凍結の日時を記録して組み合わせ決定中にする
  freeze(yearTournamentId: string, at: Date): Promise<'frozen' | 'already'>;
  // 組み合わせ決定中の年だけに書く
  markDrawn(
    yearTournamentId: string,
    input: YearDrawRecord,
    at: Date,
  ): Promise<void>;
  // 終了していない年だけを終え、この呼び出しで確定させたらtrue
  recordFinish(
    yearTournamentId: string,
    outcome: YearTournamentFinish['outcome'],
    championEntryId: string | null,
    at: Date,
  ): Promise<boolean>;
  // 受賞の日時が[from, to)の受賞を受賞の昇順で返す。紐付けを解除した優勝の枠は除く
  listAwardedBetween(
    from: Date,
    to: Date,
  ): Promise<readonly YearAwardedProduct[]>;
  // プロダクトごとの受賞を受賞の昇順で返す。紐付けを解除した受賞は除く
  listAwardsByProducts(
    productIds: readonly string[],
  ): Promise<readonly YearProductAward[]>;
}

export interface YearEntryRecord {
  readonly entryId: string;
  readonly weekTournamentId: string;
  // Week優勝の週の識別子('2026-W37')
  readonly weekPeriod: string;
  // 物理削除で紐付けを解除した枠はnull
  readonly launchId: string | null;
  readonly productId: string | null;
  readonly ownerUserId: string | null;
  readonly launchDate: BusinessDate;
  readonly qualifierUpvoteCount: number;
  readonly qualifierLastUpvoteElapsedMs: number | null;
  readonly awardedAt: Date;
  readonly awardedDate: BusinessDate;
  readonly status: YearEntryStatus;
  readonly entitlementSource: YearEntitlementSource | null;
  readonly purchaseId: string | null;
  readonly closeReason: YearEntryCloseReason | null;
  readonly classifiedYear: number | null;
  readonly refundStatus: YearRefundStatus;
  readonly refundNoticeStatus: YearRefundNoticeStatus;
}

export interface NewYearEntry {
  // 呼び出し元が採番する
  readonly entryId: string;
  readonly weekTournamentId: string;
  readonly weekPeriod: string;
  readonly launchId: string;
  readonly productId: string;
  readonly ownerUserId: string;
  readonly launchDate: BusinessDate;
  readonly qualifierMatchId: string;
  // 予選のマッチの確定値を写す
  readonly qualifierUpvoteCount: number;
  readonly qualifierLastUpvoteElapsedMs: number | null;
  // Week優勝の日時と業務日付
  readonly awardedAt: Date;
  readonly awardedDate: BusinessDate;
  // entitledは出どころをUltrasにする
  readonly initialStatus: 'awaiting_payment' | 'entitled';
}

export interface YearEntryClassification {
  readonly entryId: string;
  readonly status: 'drawn' | 'expired' | 'forfeited' | 'excluded';
  readonly closeReason: YearEntryCloseReason | null;
  // 受付中の枠に組み合わせ決定の時点でUltrasの参加資格を与えるときだけ指定する
  readonly entitlementSource?: 'ultras';
}

// Week優勝の日の範囲[awardedFrom, awardedBefore)。awardedFromがnullなら下限を設けない
export interface YearCandidateRange {
  readonly awardedFrom: BusinessDate | null;
  readonly awardedBefore: BusinessDate;
}

export type YearRefundClosedStatus = Extract<
  YearRefundStatus,
  'not_needed' | 'already_refunded' | 'rejected'
>;

export interface YearEntryStore {
  // 凍結済みの年の決済期限日がWeek優勝の日より後なら期限切れ(遅れ)で挿入する
  insertFromChampion(
    entry: NewYearEntry,
    at: Date,
  ): Promise<'inserted' | 'late' | 'exists'>;
  // 枠のあるWeekトーナメントのIDを返す
  findByWeekTournaments(ids: readonly string[]): Promise<ReadonlySet<string>>;
  // 枠の無いローンチは結果に含めない
  findByLaunches(
    launchIds: readonly string[],
  ): Promise<ReadonlyMap<string, YearEntryRecord>>;
  findEntry(entryId: string): Promise<YearEntryRecord | undefined>;
  listOpenByOwner(userId: string): Promise<readonly YearEntryRecord[]>;
  // プロダクトの枠のローンチを、枠の状態によらず重複を除いてローンチのIDの昇順で返す。紐付けを解除した枠は含めない
  listLaunchIdsByProduct(productId: string): Promise<readonly string[]>;
  // 受付中・参加資格の枠のうちWeek優勝の日が範囲にあるものを、afterEntryIdより後から枠のIDの昇順で返す
  listCandidates(
    range: YearCandidateRange,
    afterEntryId: string | undefined,
    limit: number,
  ): Promise<readonly YearEntryRecord[]>;
  listDrawn(year: number): Promise<readonly YearEntryRecord[]>;
  // 凍結の対象外の受付中の枠に参加資格を与え、そのIDを返す
  grantByUltras(
    entryIds: readonly string[],
    at: Date,
  ): Promise<readonly string[]>;
  // 凍結の対象外の受付中・参加資格の枠を喪失にし、そのIDを返す
  forfeitByProduct(productId: string, at: Date): Promise<readonly string[]>;
  forfeitByOwner(userId: string, at: Date): Promise<readonly string[]>;
  // 受付中・参加資格の枠だけを書き換え、終えた年を記録する
  classify(
    year: number,
    updates: readonly YearEntryClassification[],
    at: Date,
  ): Promise<void>;
  // 組み合わせの対象の枠だけを上限による除外にする
  excludeOverCapacity(
    year: number,
    entryIds: readonly string[],
    at: Date,
  ): Promise<void>;
  // 返金待ち・知らせ待ちの枠のうち、更新がolderThanより前のものを返す
  listPendingFollowUps(
    olderThan: Date,
    limit: number,
  ): Promise<readonly YearEntryRecord[]>;
  // 返金待ちの枠だけを依頼済みにし、返金の知らせを知らせ待ちにする
  markRefundRequested(entryId: string, at: Date): Promise<void>;
  // 返金待ちの枠だけを、依頼をせずに終えた状態にする(返金の知らせは送らない)
  markRefundClosed(
    entryId: string,
    status: YearRefundClosedStatus,
    at: Date,
  ): Promise<void>;
  // 知らせ待ちの枠だけを送信済み・省略にする
  markNotice(
    entryId: string,
    status: 'sent' | 'skipped',
    at: Date,
  ): Promise<void>;
  // 組み合わせに入った枠は紐付けだけを解除して残し、それ以外の枠は削除する
  unlinkOrDeleteByProduct(
    productId: string,
  ): Promise<{ readonly unlinked: number; readonly deleted: number }>;
}

export type YearCalendarEntry = YearCalendarYear & {
  readonly record: YearTournamentRecord | null;
};

export interface YearCalendar {
  // 行の無い年は既定の日から求める。行を作らない
  describe(
    years: readonly number[],
    now: Date,
  ): Promise<ReadonlyMap<number, YearCalendarEntry>>;
  // 行を作らない
  resolveAward(
    awardedDate: BusinessDate,
    now: Date,
  ): Promise<TargetYearResolution>;
  // 現在の年から順に、開催予定・受付中の最初の年
  upcoming(now: Date): Promise<YearCalendarYear>;
  // upcomingの行が無ければ既定の日で作る
  ensureUpcoming(now: Date): Promise<YearTournamentRecord>;
  // 凍結済みの最新の年の決済期限日の0:00。凍結済みの年が無ければnull
  openPeriodStart(now: Date): Promise<Date | null>;
}

export interface YearEntryRegistrar {
  syncChampions(input: {
    readonly awardedFrom: Date | null;
    readonly now: Date;
  }): Promise<{
    readonly created: readonly string[];
    readonly late: readonly string[];
    readonly skipped: number;
  }>;
}

export interface YearDrawService {
  // 1回に最大2年
  drawDue(now: Date): Promise<{
    readonly drawn: readonly number[];
    readonly failed: readonly number[];
  }>;
}

export interface YearProgressionService {
  // 進行中でなければundefined
  advance(
    yearTournamentId: string,
    now: Date,
  ): Promise<AdvanceResult | undefined>;
  advanceAll(
    now: Date,
  ): Promise<{ readonly advanced: number; readonly failed: readonly number[] }>;
  // 結果と予告の発行→受賞の発行→終了の記録の順に行う
  applyResult(
    tournament: YearTournamentRecord,
    result: AdvanceResult,
    now: Date,
  ): Promise<void>;
}

export interface YearNotificationPublisher {
  publishRound(input: {
    readonly decidedMatchIds: readonly string[];
    readonly previewMatchIds: readonly string[];
    readonly at: Date;
  }): Promise<void>;
  publishAward(input: {
    readonly year: number;
    readonly productId: string;
    readonly at: Date;
  }): Promise<void>;
  // その夜の結果・翌日の予告・その日の受賞をまとめて発行する
  publishEvening(input: {
    // 23:45のジョブの予定時刻の業務日付
    readonly date: BusinessDate;
    readonly at: Date;
  }): Promise<void>;
}

export interface YearEntryFollowUp {
  // 返金待ち・知らせ待ちの枠を処理する
  process(entryIds: readonly string[], now: Date): Promise<void>;
  processYear(year: number, now: Date): Promise<void>;
}

export interface YearAward {
  readonly kind: 'product_of_the_year';
  // 対象年('2026')
  readonly period: string;
}

export interface YearAwardExport {
  listForLaunches(
    launchIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly YearAward[]>>;
}
