import { inject, injectable } from 'inversify';

import type {
  LifecycleHandlerOutcome,
  UserLifecycleAsyncHandler,
  UserLifecycleEvent,
} from '../../../lib/core/identity/user-lifecycle.ts';
import { EVENT_MATCH_TYPES } from './event-match-types.ts';
import type { MatchPurgeStore } from './ports.ts';

export const UPVOTE_ERASURE_BATCH_SIZE = 1000;

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const CONTINUE: LifecycleHandlerOutcome = Object.freeze({ kind: 'continue' });

// match_upvotes.user_idがusersを外部キーで参照するため、アカウント機能が利用者の行を消す前に全てのUpvoteを消し切る。
// 残りのUpvoteを毎回D1から選び直すため、再試行・送り直し・続きの再開で同じイベントを何度処理しても結果が変わらない
@injectable()
export class UpvoteErasureHandler implements UserLifecycleAsyncHandler {
  constructor(
    @inject(EVENT_MATCH_TYPES.MatchPurgeStore)
    private readonly store: MatchPurgeStore,
  ) {}

  // 上限の件数ちょうどを消した回は残りがあるか分からないため続きとし、次の回で上限未満になってから投稿者の紐付けを外す
  async handle(event: UserLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    const deleted = await this.store.deleteUpvotesBatch(
      event.userId,
      UPVOTE_ERASURE_BATCH_SIZE,
    );
    if (deleted >= UPVOTE_ERASURE_BATCH_SIZE) {
      return CONTINUE;
    }
    // 投稿者の紐付けはプロダクトの物理削除の処理で外れるが、外部キーの無い列は物理削除の段階で取り残しを検出できないため、ここで残りを外す
    await this.store.clearOwner(event.userId);
    return DONE;
  }
}
