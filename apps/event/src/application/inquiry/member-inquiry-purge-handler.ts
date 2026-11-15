import { inject, injectable } from 'inversify';

import type {
  LifecycleHandlerOutcome,
  UserLifecycleAsyncHandler,
  UserLifecycleEvent,
} from '../../../lib/core/identity/user-lifecycle.ts';
import { EVENT_INQUIRY_TYPES } from './event-inquiry-types.ts';
import type { MemberInquiryPurgeStore } from './ports.ts';

export const MEMBER_INQUIRY_PURGE_BATCH_SIZE = 100;

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const CONTINUE: LifecycleHandlerOutcome = Object.freeze({ kind: 'continue' });

// 残りの問い合わせを毎回D1から選び直すため、再試行・送り直し・続きの再開で同じイベントを何度処理しても結果が変わらない
@injectable()
export class MemberInquiryPurgeHandler implements UserLifecycleAsyncHandler {
  constructor(
    @inject(EVENT_INQUIRY_TYPES.MemberInquiryPurgeStore)
    private readonly store: MemberInquiryPurgeStore,
  ) {}

  async handle(event: UserLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    const { hasMore } = await this.store.purgeBatch(
      event.userId,
      MEMBER_INQUIRY_PURGE_BATCH_SIZE,
    );
    return hasMore ? CONTINUE : DONE;
  }
}
