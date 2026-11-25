import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  LifecycleHandlerOutcome,
  UserLifecycleAsyncHandler,
  UserLifecycleEvent,
} from '../../../lib/core/identity/user-lifecycle.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { WEEK_TOURNAMENT_TYPES } from '../../../lib/core/week-tournament/identifiers.ts';
import type {
  WeekEntryFollowUp,
  WeekTournamentStore,
} from '../../../lib/core/week-tournament/ports.ts';
import { followUpPendingEntries } from './follow-up-pending-entries.ts';

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

// 未完了の決済の失効はpaymentsの退会の処理が全種別に対して行うため、ここでは喪失と返金だけを扱う。
// 退会済みの利用者には連絡先が引けず、返金の知らせは送らずに省略される。
// 喪失は凍結前の受付中・資格を得た枠だけを書き換え、返金の依頼は枠ごとの依頼キーで重複を除かれるため、再試行・送り直しで同じイベントを何度処理してもよい。失敗は捕まえずに投げ、イベントの再試行に任せる
@injectable()
export class AccountEntryLossHandler implements UserLifecycleAsyncHandler {
  constructor(
    @inject(WEEK_TOURNAMENT_TYPES.WeekTournamentStore)
    private readonly store: WeekTournamentStore,
    @inject(WEEK_TOURNAMENT_TYPES.WeekEntryFollowUp)
    private readonly followUp: WeekEntryFollowUp,
    @inject(PLATFORM_TYPES.Clock)
    private readonly clock: Clock,
  ) {}

  async handle(event: UserLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    const now = this.clock.now();
    await this.store.forfeitByOwner(event.userId, 'withdrawn', now);
    await followUpPendingEntries(
      this.store,
      this.followUp,
      { ownerUserId: event.userId },
      now,
    );
    return DONE;
  }
}
