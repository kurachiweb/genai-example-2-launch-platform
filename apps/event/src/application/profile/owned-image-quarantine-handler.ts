import { inject, injectable } from 'inversify';

import type {
  LifecycleHandlerOutcome,
  UserLifecycleAsyncHandler,
  UserLifecycleEvent,
} from '../../../lib/core/identity/user-lifecycle.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { MEDIA_TYPES } from '../../../lib/core/media/identifiers.ts';
import type { MediaQuarantine } from '../../../lib/core/media/ports.ts';

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const CONTINUE: LifecycleHandlerOutcome = Object.freeze({ kind: 'continue' });

const logger = getAppLogger(['event', 'profile', 'image-quarantine']);

// 保有者の画像を呼び出しのたびにD1から求め直し、理由の追加・取り除きは既にある状態に対して何も変えないため、再試行・送り直し・続きの再開で同じイベントを何度処理しても結果が変わらない。他の理由を持つ画像はユーザー停止の理由だけを外すので隔離のまま残る。移動の依頼の送信の失敗は捕まえずに投げ、メッセージの再試行に任せる
@injectable()
export class OwnedImageQuarantineHandler implements UserLifecycleAsyncHandler {
  constructor(
    @inject(MEDIA_TYPES.MediaQuarantine)
    private readonly quarantine: MediaQuarantine,
  ) {}

  async handle(event: UserLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    const owner = { kind: 'user', id: event.userId } as const;
    switch (event.type) {
      case 'suspended': {
        const { hasMore } = await this.quarantine.addReasonForOwner(
          owner,
          'user_suspended',
        );
        return hasMore ? CONTINUE : DONE;
      }
      case 'unsuspended': {
        const { hasMore } = await this.quarantine.removeReasonForOwner(
          owner,
          'user_suspended',
        );
        return hasMore ? CONTINUE : DONE;
      }
      default:
        logger.warn(
          '停止・停止解除以外のライフサイクルイベントのため画像の隔離を変えずに終えました',
          {
            eventId: event.id,
            userId: event.userId,
            type: event.type,
            outcome: 'ignored',
          },
        );
        return DONE;
    }
  }
}
