import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  LifecycleHandlerOutcome,
  UserLifecycleAsyncHandler,
  UserLifecycleEvent,
} from '../../../lib/core/identity/user-lifecycle.ts';
import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import type {
  MatchEventDispatcher,
  MatchEventStore,
} from '../../../lib/core/match/ports.ts';
import type {
  ProductLifecycleAsyncHandler,
  ProductLifecycleEvent,
} from '../../../lib/core/product/product-lifecycle.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';

// 即時の終了は事象の発生日時を確定の日時にするため、発生日時から遡れば対象のマッチを含められる
export const DECISION_FOLLOW_UP_LOOKBACK_MS = 86_400_000;

export const DECISION_FOLLOW_UP_LIMIT = 100;

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const CONTINUE: LifecycleHandlerOutcome = Object.freeze({ kind: 'continue' });

// 対象を呼び出しのたびにD1から求め直し、確定のイベントはマッチごとに1件しか作られないため、再試行・送り直しで何度呼んでも結果が変わらない。送れなかったイベントは日次のジョブの掃き出しと送り直しが拾う
// 上限ちょうどなら残りのマッチがあり得る。日次のジョブを待つと即時の終了から結果の記録まで最大で約19時間空くため、続きを返して数秒後に残りを作る。イベントを作ったマッチは次の呼び出しの対象から外れるので、続きは必ず終わる
async function followUpDecisions(
  events: MatchEventStore,
  dispatcher: MatchEventDispatcher,
  occurredAt: Date,
  now: Date,
): Promise<LifecycleHandlerOutcome> {
  const created = await events.createMissingDecidedEvents(
    new Date(occurredAt.getTime() - DECISION_FOLLOW_UP_LOOKBACK_MS),
    now,
    DECISION_FOLLOW_UP_LIMIT,
  );
  if (created.length > 0) {
    await dispatcher.publish(created);
  }
  return created.length < DECISION_FOLLOW_UP_LIMIT ? DONE : CONTINUE;
}

@injectable()
export class AccountDecisionFollowUpHandler implements UserLifecycleAsyncHandler {
  constructor(
    @inject(MATCH_PLATFORM_TYPES.MatchEventStore)
    private readonly events: MatchEventStore,
    @inject(MATCH_PLATFORM_TYPES.MatchEventDispatcher)
    private readonly dispatcher: MatchEventDispatcher,
    @inject(PLATFORM_TYPES.Clock)
    private readonly clock: Clock,
  ) {}

  handle(event: UserLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    return followUpDecisions(
      this.events,
      this.dispatcher,
      event.occurredAt,
      this.clock.now(),
    );
  }
}

@injectable()
export class ProductDecisionFollowUpHandler implements ProductLifecycleAsyncHandler {
  constructor(
    @inject(MATCH_PLATFORM_TYPES.MatchEventStore)
    private readonly events: MatchEventStore,
    @inject(MATCH_PLATFORM_TYPES.MatchEventDispatcher)
    private readonly dispatcher: MatchEventDispatcher,
    @inject(PLATFORM_TYPES.Clock)
    private readonly clock: Clock,
  ) {}

  handle(event: ProductLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    return followUpDecisions(
      this.events,
      this.dispatcher,
      event.occurredAt,
      this.clock.now(),
    );
  }
}
