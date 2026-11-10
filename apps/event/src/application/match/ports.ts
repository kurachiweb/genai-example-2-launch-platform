import type {
  MatchEventHandler,
  MatchEventRegistration,
} from '../../../lib/core/match/match-events.ts';

export interface MatchEventHandlerResolver {
  resolve(registration: MatchEventRegistration): MatchEventHandler;
}

export interface MatchPurgeStore {
  // 論理削除済みを含む利用者のUpvoteを最大limit件まで物理削除し、消した件数を返す
  deleteUpvotesBatch(userId: string, limit: number): Promise<number>;
  // 投稿者として残る側のowner_user_idをNULLにする。行が無ければ何もしない
  clearOwner(userId: string): Promise<void>;
  // プロダクトの側のプロダクト・ローンチ・投稿者の紐付けをNULLにし、解除の日時を記録する。確定値と結果は残す
  unlinkProduct(productId: string, at: Date): Promise<void>;
}
