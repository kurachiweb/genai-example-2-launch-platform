import { LIFECYCLE_CONTINUE_DELAY_SECONDS } from '../../../lib/core/identity/user-lifecycle.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type {
  MatchEvent,
  MatchEventRegistry,
} from '../../../lib/core/match/match-events.ts';
import type {
  MatchEventStore,
  StoredMatchEvent,
} from '../../../lib/core/match/ports.ts';
import type { RunMatchEventBody } from '../../../lib/core/messaging/contracts/match.ts';
import type {
  MessageHandler,
  MessageHandlingResult,
} from '../../../lib/core/messaging/message-contract.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type { MatchEventHandlerResolver } from './ports.ts';

export const MATCH_EVENT_ORDER_WAIT_SECONDS = 60;

export interface MatchEventRunnerDependencies {
  readonly store: MatchEventStore;
  readonly registry: MatchEventRegistry;
  readonly resolver: MatchEventHandlerResolver;
  readonly clock: Clock;
}

type EventLogAttributes = Readonly<{
  eventId: string;
  type: string;
}>;

const DONE: MessageHandlingResult = Object.freeze({ kind: 'done' });

const logger = getAppLogger(['event', 'match', 'events']);

function attributesOf(event: StoredMatchEvent): EventLogAttributes {
  return { eventId: event.id, type: event.type };
}

// 処理が送信の回数などの記録の状態に依存しないよう、契約の項目だけを渡す
function toMatchEvent(event: StoredMatchEvent): MatchEvent {
  return Object.freeze({
    id: event.id,
    matchId: event.matchId,
    kind: event.kind,
    type: event.type,
    occurredAt: event.occurredAt,
  });
}

// 処理とストアの例外は捕まえずに投げ、メッセージの再試行に任せる。完了の記録は残るため、再試行は未完了の処理から続く
export class MatchEventRunner implements MessageHandler<RunMatchEventBody> {
  private readonly store: MatchEventStore;
  private readonly registry: MatchEventRegistry;
  private readonly resolver: MatchEventHandlerResolver;
  private readonly clock: Clock;

  constructor(dependencies: MatchEventRunnerDependencies) {
    this.store = dependencies.store;
    this.registry = dependencies.registry;
    this.resolver = dependencies.resolver;
    this.clock = dependencies.clock;
  }

  async handle(body: RunMatchEventBody): Promise<MessageHandlingResult> {
    const event = await this.store.findEvent(body.eventId);
    if (event === undefined) {
      logger.info('マッチイベントが見つからないため終えました', {
        eventId: body.eventId,
        outcome: 'missing',
      });
      return DONE;
    }
    const attributes = attributesOf(event);
    if (event.status === 'completed') {
      logger.info('完了済みのマッチイベントのため終えました', {
        ...attributes,
        outcome: 'already-completed',
      });
      return DONE;
    }
    const oldest = await this.store.findOldestPending(event.matchId);
    if (oldest !== undefined && oldest.id !== event.id) {
      logger.info('同じマッチのより前のイベントの完了を待ちます', {
        ...attributes,
        outcome: 'waiting-for-earlier-event',
      });
      return { kind: 'defer', delaySeconds: MATCH_EVENT_ORDER_WAIT_SECONDS };
    }
    const continued = await this.runHandlers(event, attributes);
    if (continued) {
      return { kind: 'defer', delaySeconds: LIFECYCLE_CONTINUE_DELAY_SECONDS };
    }
    await this.store.markEventCompleted(event.id, this.clock.now());
    logger.info('マッチイベントの処理を完了しました', {
      ...attributes,
      outcome: 'completed',
    });
    return DONE;
  }

  // 続きのある処理で止めた場合にtrueを返す
  private async runHandlers(
    event: StoredMatchEvent,
    attributes: EventLogAttributes,
  ): Promise<boolean> {
    const completed = await this.store.completedHandlers(event.id);
    const matchEvent = toMatchEvent(event);
    for (const registration of this.registry.handlersFor(event)) {
      if (completed.has(registration.name)) {
        continue;
      }
      const handler = this.resolver.resolve(registration);
      const outcome = await handler.handle(matchEvent);
      if (outcome.kind === 'continue') {
        logger.info('処理に続きがあるため後で再開します', {
          ...attributes,
          handler: registration.name,
          outcome: 'continued',
        });
        return true;
      }
      await this.store.markHandlerCompleted(
        event.id,
        registration.name,
        this.clock.now(),
      );
      logger.info('処理を完了しました', {
        ...attributes,
        handler: registration.name,
        outcome: 'handler-completed',
      });
    }
    return false;
  }
}
