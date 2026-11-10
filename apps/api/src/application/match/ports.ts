import type { MatchPhase } from '../../../lib/core/match/match-model.ts';
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
