import { inject, injectable } from 'inversify';

import type {
  LifecycleHandlerOutcome,
  UserLifecycleAsyncHandler,
  UserLifecycleEvent,
} from '../../../lib/core/identity/user-lifecycle.ts';
import { EVENT_SPONSORSHIP_TYPES } from './event-sponsorship-types.ts';
import type { SponsorshipPurgeStore } from './ports.ts';

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

// 申込の行がusersを外部キーで参照するため、アカウント機能が利用者の行を消す前に消す。決済履歴は決済の機能が仮名化IDで残すため触れない。
// 残りの行を毎回D1から選び直して消すため、再試行・送り直しで同じイベントを何度処理しても結果が変わらない
@injectable()
export class AccountPurgeHandler implements UserLifecycleAsyncHandler {
  constructor(
    @inject(EVENT_SPONSORSHIP_TYPES.SponsorshipPurgeStore)
    private readonly store: SponsorshipPurgeStore,
  ) {}

  async handle(event: UserLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    await this.store.purgeByUser(event.userId);
    return DONE;
  }
}
