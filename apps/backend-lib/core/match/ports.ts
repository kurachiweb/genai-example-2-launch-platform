import type { BusinessDate } from '../time/business-time.ts';
import type { MatchEvent } from './match-events.ts';
import type {
  EntryResult,
  MatchDecision,
  MatchKind,
  MatchPhase,
  MatchStage,
  MatchTimes,
} from './match-model.ts';

export interface MatchEntryRecord {
  readonly entryId: string;
  readonly slot: 1 | 2;
  // 物理削除で紐付けを解除した側はnull
  readonly launchId: string | null;
  readonly productId: string | null;
  readonly ownerUserId: string | null;
  readonly upvoteCount: number;
  readonly lastUpvotedAt: Date | null;
  // 最終Upvote時間(開始の日時からの経過)
  readonly lastUpvoteElapsedMs: number | null;
  readonly forfeited: boolean;
  readonly result: EntryResult | null;
}

export interface MatchRecord extends MatchTimes {
  readonly matchId: string;
  readonly kind: MatchKind;
  // トーナメントの1回戦が1。予選はnull
  readonly round: number | null;
  readonly stage: MatchStage | null;
  readonly matchDate: BusinessDate;
  readonly decision: MatchDecision | null;
  readonly endedEarly: boolean;
  // 照会の時点で導いた値
  readonly phase: MatchPhase;
  // 側の番号の昇順
  readonly entries: readonly MatchEntryRecord[];
}

export interface QualifierResultRecord {
  readonly launchId: string;
  readonly matchId: string;
  readonly result: EntryResult;
  readonly upvoteCount: number;
  readonly lastUpvotedAt: Date | null;
  readonly decidedAt: Date;
}

export interface DailyMatchSummary {
  readonly date: BusinessDate;
  // 開始した2つの側の予選。即時の終了を含み、不戦勝と開始時点の決着を除く
  readonly qualifierMatches: number;
  // 確定したマッチ(全種別)のUpvote数の合計
  readonly upvotes: number;
}

export interface MatchDirectory {
  // 重複を除いて90件ずつ読む
  findMatches(
    matchIds: readonly string[],
    now: Date,
  ): Promise<ReadonlyMap<string, MatchRecord>>;
  // マッチのIDの昇順
  listForDate(input: {
    readonly date: BusinessDate;
    readonly kinds: readonly MatchKind[];
    readonly now: Date;
  }): Promise<readonly MatchRecord[]>;
  // ローンチごとに実施日の新しい順。マッチの無いローンチは含めない
  listByLaunches(
    launchIds: readonly string[],
    now: Date,
  ): Promise<ReadonlyMap<string, readonly MatchRecord[]>>;
  // 結果が確定した予選の側だけ
  findQualifierResults(
    launchIds: readonly string[],
  ): Promise<ReadonlyMap<string, QualifierResultRecord>>;
  // 両端を含む最大366日を日付の古い順に、マッチの無い日も0で返す
  summarizeDaily(input: {
    readonly from: BusinessDate;
    readonly to: BusinessDate;
  }): Promise<readonly DailyMatchSummary[]>;
}

export interface SupporterCursor {
  readonly upvotedAt: Date;
  readonly upvoteId: string;
}

export interface SupporterRecord {
  readonly upvoteId: string;
  readonly userId: string;
  readonly upvotedAt: Date;
}

export interface SupporterDirectory {
  // 結果が確定したマッチの側の有効なUpvoteのうち、可視の利用者のものをUpvoteの日時の早い順に返す。確定していなければ空
  listSupporters(input: {
    readonly entryId: string;
    readonly after: SupporterCursor | undefined;
    // 1〜20
    readonly limit: number;
  }): Promise<readonly SupporterRecord[]>;
}

export interface ScheduledEntryInput {
  readonly launchId: string;
  readonly productId: string;
  readonly ownerUserId: string;
}

export interface MatchScheduleInput {
  // 呼び出し元が採番し、再実行で同じ値を渡せば重複しない
  readonly matchId: string;
  readonly kind: MatchKind;
  readonly round: number | null;
  readonly stage: MatchStage | null;
  readonly matchDate: BusinessDate;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly entries:
    | readonly [ScheduledEntryInput]
    | readonly [ScheduledEntryInput, ScheduledEntryInput];
}

export interface MatchScheduler {
  // 1〜50件を1つの一括の書き込みで確定し、確定の後にイベントを送る。createdはイベントを作ったマッチのID
  schedule(
    inputs: readonly MatchScheduleInput[],
    at: Date,
  ): Promise<{
    readonly created: readonly string[];
    readonly skipped: readonly string[];
  }>;
}

export interface StoredMatchEvent extends MatchEvent {
  readonly status: 'pending' | 'completed';
  readonly dispatchCount: number;
  readonly lastDispatchedAt: Date;
}

export interface MatchEventStore {
  findEvent(eventId: string): Promise<StoredMatchEvent | undefined>;
  findOldestPending(matchId: string): Promise<StoredMatchEvent | undefined>;
  completedHandlers(eventId: string): Promise<ReadonlySet<string>>;
  // 重複は無視する
  markHandlerCompleted(
    eventId: string,
    handlerName: string,
    at: Date,
  ): Promise<void>;
  markEventCompleted(eventId: string, at: Date): Promise<void>;
  // 確定済みで確定のイベントが無いマッチにイベントを作り、作ったイベントのIDを返す
  createMissingDecidedEvents(
    decidedSince: Date,
    at: Date,
    limit: number,
  ): Promise<readonly string[]>;
  listStalePending(
    dispatchedBefore: Date,
    limit: number,
  ): Promise<readonly StoredMatchEvent[]>;
  markRedispatched(eventIds: readonly string[], at: Date): Promise<void>;
  // 処理の記録とイベントを消し、消したイベントの数を返す
  deleteCompletedBefore(completedBefore: Date, limit: number): Promise<number>;
}

export interface MatchEventDispatcher {
  // 失敗したイベントはpendingのまま残り、次のジョブの掃き出しと4:21に送り直される
  publish(eventIds: readonly string[]): Promise<void>;
}

export interface MatchExportRecord {
  readonly matchId: string;
  readonly launchId: string;
  readonly kind: MatchKind;
  readonly round: number | null;
  readonly date: BusinessDate;
  readonly upvoteCount: number;
  // 不戦勝は0
  readonly opponentUpvoteCount: number;
  readonly lastUpvotedAt: Date | null;
  // 未確定はnull
  readonly result: EntryResult | null;
}

export interface MatchExport {
  // 実施日の古い順
  listForLaunches(
    launchIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly MatchExportRecord[]>>;
}

export interface UpvoteExportRecord {
  readonly matchId: string;
  readonly matchKind: MatchKind;
  readonly matchDate: BusinessDate;
  // 紐付けを解除済みならnull。名称とハンドルは呼び出し元がプロダクトの照会で引く
  readonly productId: string | null;
  readonly upvotedAt: Date;
}

export interface UpvoteExport {
  // 有効なUpvoteを、Upvoteの日時の古い順に返す
  listByUser(userId: string): Promise<readonly UpvoteExportRecord[]>;
}
