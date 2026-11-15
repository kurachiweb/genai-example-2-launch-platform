import { inject, injectable } from 'inversify';

import type {
  LifecycleHandlerOutcome,
  UserLifecycleAsyncHandler,
  UserLifecycleEvent,
} from '../../../lib/core/identity/user-lifecycle.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../../lib/core/notifications/identifiers.ts';
import type {
  NotificationNoticeStore,
  NotificationPreferenceStore,
  UnsubscribeTokenService,
} from '../../../lib/core/notifications/ports.ts';

export const ACCOUNT_PURGE_BATCH_SIZE = 1000;

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const CONTINUE: LifecycleHandlerOutcome = Object.freeze({ kind: 'continue' });

// 通知・受信設定・トークンの種の行がusersを外部キーで参照するため、アカウント機能が利用者の行を消す前に全て消し切る。
// 受信設定とトークンの種は退会の確定で消えるが、確かめ直しの後に退会が確定した送信が種を作り直し得るため、残りをここで消す。
// 残りの行を毎回D1から選び直すため、再試行・送り直し・続きの再開で同じイベントを何度処理しても結果が変わらない
@injectable()
export class AccountPurgeHandler implements UserLifecycleAsyncHandler {
  constructor(
    @inject(NOTIFICATIONS_PLATFORM_TYPES.NotificationNoticeStore)
    private readonly notices: NotificationNoticeStore,
    @inject(NOTIFICATIONS_PLATFORM_TYPES.NotificationPreferenceStore)
    private readonly preferences: NotificationPreferenceStore,
    @inject(NOTIFICATIONS_PLATFORM_TYPES.UnsubscribeTokenService)
    private readonly tokens: UnsubscribeTokenService,
  ) {}

  // 上限の件数ちょうどを消した回は残りがあるか分からないため続きとし、次の回で上限未満になってから残りを消す
  async handle(event: UserLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    const deleted = await this.notices.deleteByRecipient(
      event.userId,
      ACCOUNT_PURGE_BATCH_SIZE,
    );
    if (deleted >= ACCOUNT_PURGE_BATCH_SIZE) {
      return CONTINUE;
    }
    await this.tokens.deleteAllOf(event.userId);
    await this.preferences.deleteAllOf(event.userId);
    return DONE;
  }
}
