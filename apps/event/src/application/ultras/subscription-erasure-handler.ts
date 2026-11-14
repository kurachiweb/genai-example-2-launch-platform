import { inject, injectable } from 'inversify';

import type {
  LifecycleHandlerOutcome,
  UserLifecycleAsyncHandler,
  UserLifecycleEvent,
} from '../../../lib/core/identity/user-lifecycle.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { EVENT_ULTRAS_TYPES } from './event-ultras-types.ts';
import type { UltrasAccountDataEraser } from './ultras-account-data-eraser.ts';

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const logger = getAppLogger(['event', 'ultras', 'erasure']);

// 削除の書き込みの単位は行が無ければ何もしないため、再試行・再配信で同じイベントを何度処理しても結果が変わらない
@injectable()
export class SubscriptionErasureHandler implements UserLifecycleAsyncHandler {
  constructor(
    @inject(EVENT_ULTRAS_TYPES.UltrasAccountDataEraser)
    private readonly eraser: UltrasAccountDataEraser,
  ) {}

  async handle(event: UserLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    await this.eraser.erase(event.userId);
    logger.info('物理削除する利用者のUltrasの行を削除しました', {
      eventId: event.id,
      userId: event.userId,
      outcome: 'erased',
    });
    return DONE;
  }
}
