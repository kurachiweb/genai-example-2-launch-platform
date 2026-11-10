import type { MatchPhase } from '../../../lib/core/match/match-model.ts';
import type { BusinessDate } from '../../../lib/core/time/business-time.ts';
import type {
  EntryTally,
  MatchOutcome,
} from '../../../lib/core/match/match-decision.ts';
import type { UpvoteAction } from '../../domain/match/upvote-plan.ts';

export interface UpvoteState {
  readonly matchId: string;
  readonly phase: MatchPhase;
  // 側の番号の順
  readonly entryIds: readonly string[];
  // 紐付けを解除した側はnull
  readonly ownerUserIds: readonly (string | null)[];
  // 利用者の有効なUpvoteの側
  readonly currentEntryId: string | null;
}

// rejectedは記録の時点の条件(受け付け中・側・自分のマッチ・利用者の状態)の不成立、duplicateは同時の追加で既に有効なUpvoteがあること
export type UpvoteWriteResult = 'applied' | 'rejected' | 'duplicate';

export interface UpvoteApplyInput {
  readonly action: Exclude<UpvoteAction, { readonly kind: 'none' }>;
  readonly matchId: string;
  readonly userId: string;
  readonly upvoteId: string;
  readonly now: Date;
}

export interface UpvoteCancelInput {
  readonly matchId: string;
  readonly userId: string;
  readonly now: Date;
}

export interface UpvoteStore {
  findState(
    matchId: string,
    userId: string,
    now: Date,
  ): Promise<UpvoteState | undefined>;
  apply(input: UpvoteApplyInput): Promise<UpvoteWriteResult>;
  // nothingは、受け付け中のマッチに利用者の有効なUpvoteが無かったこと
  cancel(input: UpvoteCancelInput): Promise<'cancelled' | 'nothing'>;
}

export interface MatchBoardStore {
  // マッチID → 有効なUpvoteの側のID。有効なUpvoteの無いマッチは含めない
  viewerUpvotes(
    matchIds: readonly string[],
    userId: string,
  ): Promise<ReadonlyMap<string, string>>;
}

export interface DueSettlement {
  readonly matchId: string;
  // 側の番号の順。値は保存済みの集計値
  readonly entries: readonly EntryTally[];
  readonly entryCount: 1 | 2;
}

export interface SettlementWrite {
  readonly matchId: string;
  readonly outcome: MatchOutcome;
  readonly eventId: string;
}

export interface SettlementStore {
  // 開始が記録され終了の日時を過ぎた未確定のマッチを、終了の日時とIDの順に返す
  listDue(now: Date, limit: number): Promise<readonly DueSettlement[]>;
  // 1〜50件を1つの一括の書き込みで確定し、確定したマッチのイベントのIDを返す。既に確定していたマッチは変えず、イベントも作らない
  writeOutcomes(
    outcomes: readonly SettlementWrite[],
    at: Date,
  ): Promise<readonly string[]>;
}

// already-completedは、その日のペアリングが一度完了していること
export type PairingDayState = 'begun' | 'already-completed';

export interface PairingCounts {
  // 組んだマッチの側のローンチの数
  readonly launches: number;
  readonly matches: number;
}

export interface PairingStore {
  // 実施日の記録が無ければ未完了で作り、あれば変えない
  beginDay(date: BusinessDate, at: Date): Promise<PairingDayState>;
  // 既に完了していれば最初の完了の日時を保ち、件数を足す
  completeDay(
    date: BusinessDate,
    counts: PairingCounts,
    at: Date,
  ): Promise<void>;
  isDayCompleted(date: BusinessDate): Promise<boolean>;
  // 実施日の予選の側のローンチ。紐付けを解除した側は含めない
  pairedLaunchIds(date: BusinessDate): Promise<ReadonlySet<string>>;
}
