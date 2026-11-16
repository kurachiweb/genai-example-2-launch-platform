import type { IsoWeekKey } from '../../../common-lib/tournament/week-period.ts';
import type { MatchRecord } from '../match/ports.ts';
import type { BusinessDate } from '../time/business-time.ts';
import type { AdvanceResult } from '../tournament/ports.ts';
import type {
  WeekEntitlementSource,
  WeekEntryCloseReason,
  WeekEntryStatus,
  WeekRefundNoticeStatus,
  WeekRefundStatus,
} from './week-entry-rules.ts';
import type { WeekEntryWindow } from './week-schedule.ts';

export type WeekTournamentStatus =
  'open' | 'drawing' | 'in_progress' | 'finished';

export interface WeekTournamentRecord {
  readonly tournamentId: string;
  // 作成時に求めて保存した期限。判定は求め直さずにこの値を使う
  readonly window: WeekEntryWindow;
  readonly status: WeekTournamentStatus;
  // 凍結の日時。凍結の後は資格を変える書き込みが何もしない
  readonly drawStartedAt: Date | null;
  readonly bracketId: string | null;
  readonly outcome: 'awarded' | 'no_award' | null;
  readonly championEntryId: string | null;
  readonly awardedAt: Date | null;
}

export interface WeekEntryRecord {
  readonly entryId: string;
  readonly tournamentId: string;
  // 物理削除で紐付けを解除した枠はnull
  readonly launchId: string | null;
  readonly productId: string | null;
  readonly ownerUserId: string | null;
  readonly launchDate: BusinessDate;
  readonly qualifierUpvoteCount: number;
  readonly qualifierLastUpvoteElapsedMs: number | null;
  readonly wonAt: Date;
  readonly status: WeekEntryStatus;
  readonly entitlementSource: WeekEntitlementSource | null;
  readonly purchaseId: string | null;
  readonly closeReason: WeekEntryCloseReason | null;
  readonly refundStatus: WeekRefundStatus;
  readonly refundNoticeStatus: WeekRefundNoticeStatus;
}

interface NewWeekEntryBase {
  // 呼び出し元が採番する
  readonly entryId: string;
  readonly tournamentId: string;
  readonly launchId: string;
  readonly productId: string;
  readonly ownerUserId: string;
  readonly launchDate: BusinessDate;
  readonly qualifierMatchId: string;
  // 予選のマッチの確定値を写す
  readonly qualifierUpvoteCount: number;
  readonly qualifierLastUpvoteElapsedMs: number | null;
  // 予選のマッチの確定の日時
  readonly wonAt: Date;
  readonly at: Date;
}

export type NewWeekEntry = NewWeekEntryBase &
  (
    | {
        readonly status: 'awaiting_payment';
        readonly entitlementSource: null;
        readonly closeReason: null;
      }
    | {
        readonly status: 'entitled';
        readonly entitlementSource: 'ultras';
        readonly closeReason: null;
      }
    | {
        readonly status: 'expired';
        readonly entitlementSource: null;
        readonly closeReason: 'late_entry';
      }
  );

export interface WeekTournamentStore {
  // 週の初日の一意索引で重複を無視して作り、既にあれば保存した記録を返す
  ensureTournament(
    weekStart: BusinessDate,
    at: Date,
  ): Promise<WeekTournamentRecord>;
  findTournament(
    tournamentId: string,
  ): Promise<WeekTournamentRecord | undefined>;
  findTournamentByWeek(
    weekStart: BusinessDate,
  ): Promise<WeekTournamentRecord | undefined>;
  // 組み合わせ決定の日時が到来した受付中・組み合わせ決定中の週を、日時の昇順で返す
  listDue(now: Date, limit: number): Promise<readonly WeekTournamentRecord[]>;
  // 進行中の週を週の初日の昇順で返す
  listInProgress(limit: number): Promise<readonly WeekTournamentRecord[]>;
  // 枠の無いローンチは結果に含めない
  findEntriesByLaunch(
    launchIds: readonly string[],
  ): Promise<ReadonlyMap<string, WeekEntryRecord>>;
  findEntry(entryId: string): Promise<WeekEntryRecord | undefined>;
  // プロダクトの枠のローンチを、枠の状態によらず重複を除いてローンチのIDの昇順で返す。紐付けを解除した枠は含めない
  listLaunchIdsByProduct(productId: string): Promise<readonly string[]>;
  // 受付中・資格を得た枠を、afterEntryIdより後から枠のIDの昇順で件数の上限まで返す
  listEntriesForClassification(
    tournamentId: string,
    afterEntryId: string | undefined,
    limit: number,
  ): Promise<readonly WeekEntryRecord[]>;
  // 組み合わせの対象の枠を、紐付けを解除した枠も含めて枠のIDの昇順で返す
  listDrawnEntries(tournamentId: string): Promise<readonly WeekEntryRecord[]>;
  // ローンチと、週ごとのプロダクトの一意索引に当たればexists。
  // 受付中・資格を得た枠は凍結前の週にだけ挿入し、凍結済みの週ならfrozenを返す(期限切れの枠は凍結によらず挿入する)
  insertEntry(entry: NewWeekEntry): Promise<'inserted' | 'exists' | 'frozen'>;
  // 凍結前の週の受付中の枠のうち、勝利の確定 ≤ 有効化 ≤ 決済期限のものに参加資格を与え、そのIDを返す
  grantByUltras(
    userId: string,
    activatedAt: Date,
    at: Date,
  ): Promise<readonly string[]>;
  // 凍結前の週の受付中・資格を得た枠を喪失にし、そのIDを返す
  forfeitByProduct(
    productId: string,
    reason: 'deleted',
    at: Date,
  ): Promise<readonly string[]>;
  forfeitByOwner(
    userId: string,
    reason: 'withdrawn',
    at: Date,
  ): Promise<readonly string[]>;
  // 凍結前の週だけに凍結の日時を記録して組み合わせ決定中にし、この呼び出しで凍結したらtrue
  freeze(tournamentId: string, at: Date): Promise<boolean>;
  // 受付中・資格を得た枠だけを書き換え、それ以外の状態の枠は変えない
  classify(
    updates: readonly WeekEntryClassification[],
    at: Date,
  ): Promise<void>;
  // 組み合わせ決定中の週だけに書き、参加0・1で組み合わせと同時に終わる週はfinishedに結果を渡す
  markDrawn(
    tournamentId: string,
    bracketId: string,
    finished: WeekTournamentFinish | null,
    at: Date,
  ): Promise<void>;
  // 終了していない週だけを終え、この呼び出しで確定させたらtrue
  recordFinish(
    tournamentId: string,
    outcome: WeekTournamentFinish['outcome'],
    championEntryId: string | null,
    at: Date,
  ): Promise<boolean>;
  // 受賞の日時が[from, to)の受賞を受賞の昇順で返す。紐付けを解除した受賞は除く
  listAwardedBetween(
    from: Date,
    to: Date,
  ): Promise<readonly WeekAwardedProduct[]>;
  // 返金待ち・知らせ待ちの枠のうち、更新がolderThanより前のものを更新の昇順で返す
  listPendingFollowUps(
    olderThan: Date,
    limit: number,
  ): Promise<readonly WeekEntryRecord[]>;
  // 返金待ち・知らせ待ちの枠を、更新の日時によらずプロダクト・投稿者・週で絞って返す
  listPendingFollowUpsOf(
    target: WeekFollowUpTarget,
    limit: number,
  ): Promise<readonly WeekEntryRecord[]>;
  // 返金待ちの枠だけを依頼済みにし、返金の知らせを知らせ待ちにする
  markRefundRequested(entryId: string, at: Date): Promise<void>;
  // 返金待ちの枠だけを、依頼をせずに終えた状態にする(返金の知らせは送らない)
  markRefundClosed(
    entryId: string,
    status: WeekRefundClosedStatus,
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

export type WeekTournamentFinish =
  | { readonly outcome: 'awarded'; readonly championEntryId: string }
  | { readonly outcome: 'no_award'; readonly championEntryId: null };

export interface WeekAwardedProduct {
  readonly weekStart: BusinessDate;
  readonly productId: string;
}

export type WeekFollowUpTarget =
  | { readonly productId: string }
  | { readonly ownerUserId: string }
  | { readonly tournamentId: string };

export type WeekRefundClosedStatus = Extract<
  WeekRefundStatus,
  'not_needed' | 'already_refunded' | 'rejected'
>;

export interface WeekEntryClassification {
  readonly entryId: string;
  readonly status: 'drawn' | 'expired' | 'forfeited' | 'excluded' | 'entitled';
  readonly closeReason: WeekEntryCloseReason | null;
  // 受付中の枠に組み合わせ決定の時点でUltrasの参加資格を与えるときだけ指定する
  readonly entitlementSource?: 'ultras';
}

export interface WeekEntryRegistrar {
  // 作った枠のIDを返す
  registerFromMatch(match: MatchRecord, at: Date): Promise<readonly string[]>;
}

export interface WeekDrawService {
  drawDue(now: Date): Promise<{
    readonly drawn: readonly string[];
    readonly failed: readonly string[];
  }>;
}

export interface WeekProgressionService {
  // 進行中でなければundefined
  advance(tournamentId: string, now: Date): Promise<AdvanceResult | undefined>;
  advanceAll(
    now: Date,
  ): Promise<{ readonly advanced: number; readonly failed: readonly string[] }>;
  // 賞の記録と通知の発行
  applyResult(
    tournament: WeekTournamentRecord,
    result: AdvanceResult,
    now: Date,
  ): Promise<void>;
}

export interface WeekNotificationPublisher {
  publishRound(input: {
    readonly decidedMatchIds: readonly string[];
    readonly previewMatchIds: readonly string[];
    readonly at: Date;
  }): Promise<void>;
  publishAward(input: {
    readonly weekStart: BusinessDate;
    readonly productId: string;
    readonly at: Date;
  }): Promise<void>;
  // その夜の結果・翌日の予告・受賞をすべて発行する
  publishNight(input: {
    readonly date: BusinessDate;
    readonly at: Date;
  }): Promise<void>;
}

export interface WeekEntryFollowUp {
  // 返金待ち・知らせ待ちの枠を処理する
  process(entryIds: readonly string[], now: Date): Promise<void>;
  processTournament(tournamentId: string, now: Date): Promise<void>;
}

export interface WeekChampion {
  readonly tournamentId: string;
  readonly weekStart: BusinessDate;
  readonly productId: string;
  readonly launchId: string;
  readonly ownerUserId: string;
  readonly awardedAt: Date;
}

export interface WeekChampionDirectory {
  // 受賞の昇順。紐付けを解除済みの受賞は除く
  listChampions(input: {
    readonly awardedFrom: Date | null;
    readonly awardedBefore: Date;
  }): Promise<readonly WeekChampion[]>;
}

export interface WeekAward {
  readonly kind: 'product_of_the_week';
  readonly period: IsoWeekKey;
}

export interface WeekAwardExport {
  listForLaunches(
    launchIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly WeekAward[]>>;
}
