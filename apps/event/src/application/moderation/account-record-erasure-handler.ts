import { inject, injectable } from 'inversify';

import type {
  LifecycleHandlerOutcome,
  UserLifecycleAsyncHandler,
  UserLifecycleEvent,
} from '../../../lib/core/identity/user-lifecycle.ts';
import { MODERATION_PLATFORM_TYPES } from '../../../lib/core/moderation/identifiers.ts';
import type { ModerationRecordStore } from '../../../lib/core/moderation/ports.ts';

export const ACCOUNT_RECORD_ERASURE_BATCH_SIZE = 500;

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const CONTINUE: LifecycleHandlerOutcome = Object.freeze({ kind: 'continue' });

// 措置の記録は利用者に外部キーを張らず物理削除の検出で取り残しが分からないため、削除の後に読み直した残りの有無で続きを返し、消し切ってから完了にする。
// 対象を毎回D1から選び直すため、再試行・送り直し・続きの再開で同じイベントを何度処理しても結果が変わらない
@injectable()
export class AccountRecordErasureHandler implements UserLifecycleAsyncHandler {
  constructor(
    @inject(MODERATION_PLATFORM_TYPES.ModerationRecordStore)
    private readonly store: ModerationRecordStore,
  ) {}

  async handle(event: UserLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    const { remaining } = await this.store.eraseBySubjectUser(
      event.userId,
      ACCOUNT_RECORD_ERASURE_BATCH_SIZE,
    );
    return remaining ? CONTINUE : DONE;
  }
}
