import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { ENGAGEMENT_PLATFORM_TYPES } from '../../../lib/core/engagement/identifiers.ts';
import type { EngagementErasureStore } from '../../../lib/core/engagement/ports.ts';
import type {
  LifecycleHandlerOutcome,
  UserLifecycleAsyncHandler,
  UserLifecycleEvent,
} from '../../../lib/core/identity/user-lifecycle.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';

export const ACCOUNT_ERASURE_BATCH_SIZE = 500;

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const CONTINUE: LifecycleHandlerOutcome = Object.freeze({ kind: 'continue' });

// launch_comments.author_user_id・product_ratings.user_idがusersを外部キーで参照するため、アカウント機能が利用者の行を消す前に、コメントを匿名化して紐付けを外し評価を消し切る。
// 残りは同じ一括の書き込みの後に読み直した有無で判定し、毎回D1から選び直すため、再試行・送り直し・続きの再開で同じイベントを何度処理しても結果が変わらない
@injectable()
export class AccountErasureHandler implements UserLifecycleAsyncHandler {
  constructor(
    @inject(ENGAGEMENT_PLATFORM_TYPES.EngagementErasureStore)
    private readonly store: EngagementErasureStore,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async handle(event: UserLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    const { remaining } = await this.store.eraseAccount({
      userId: event.userId,
      at: this.clock.now(),
      limit: ACCOUNT_ERASURE_BATCH_SIZE,
    });
    return remaining ? CONTINUE : DONE;
  }
}
