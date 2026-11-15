import { inject, injectable } from 'inversify';

import type {
  LifecycleHandlerOutcome,
  UserLifecycleAsyncHandler,
  UserLifecycleEvent,
} from '../../../lib/core/identity/user-lifecycle.ts';
import { EVENT_PROFILE_TYPES } from './event-profile-types.ts';
import type { ProfilePurgeStore } from './ports.ts';

export const FOLLOW_ERASURE_BATCH_SIZE = 1000;

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const CONTINUE: LifecycleHandlerOutcome = Object.freeze({ kind: 'continue' });

// 残りのフォローを毎回D1から選び直すため、再試行・送り直し・続きの再開で同じイベントを何度処理しても結果が変わらない
@injectable()
export class ProfileErasureHandler implements UserLifecycleAsyncHandler {
  constructor(
    @inject(EVENT_PROFILE_TYPES.ProfilePurgeStore)
    private readonly store: ProfilePurgeStore,
  ) {}

  // 上限の件数ちょうどを消した回は残りがあるか分からないため続きとし、次の回で0件になってから残りの行を消す
  async handle(event: UserLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    const deleted = await this.store.deleteFollowsBatch(
      event.userId,
      FOLLOW_ERASURE_BATCH_SIZE,
    );
    if (deleted >= FOLLOW_ERASURE_BATCH_SIZE) {
      return CONTINUE;
    }
    await this.store.deleteProfileRows(event.userId);
    return DONE;
  }
}
