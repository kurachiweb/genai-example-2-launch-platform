import type {
  StoredLifecycleEvent,
  UserLifecycleStore,
} from '../../../lib/core/identity/ports.ts';
import {
  type AsyncLifecycleRegistry,
  LIFECYCLE_CONTINUE_DELAY_SECONDS,
  type UserLifecycleEvent,
} from '../../../lib/core/identity/user-lifecycle.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { RunUserLifecycleBody } from '../../../lib/core/messaging/contracts/identity.ts';
import type {
  MessageHandler,
  MessageHandlingResult,
} from '../../../lib/core/messaging/message-contract.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type { IdentityPurgeStore, LifecycleHandlerResolver } from './ports.ts';

export const LIFECYCLE_ORDER_WAIT_SECONDS = 60;

export interface UserLifecycleRunnerDependencies {
  readonly store: UserLifecycleStore;
  readonly registry: AsyncLifecycleRegistry;
  readonly resolver: LifecycleHandlerResolver;
  readonly purgeStore: IdentityPurgeStore;
  readonly clock: Clock;
}

type EventLogAttributes = Readonly<{
  eventId: string;
  type: string;
  userId: string;
}>;

const DONE: MessageHandlingResult = Object.freeze({ kind: 'done' });

const logger = getAppLogger(['event', 'identity', 'lifecycle']);

function attributesOf(event: StoredLifecycleEvent): EventLogAttributes {
  return { eventId: event.id, type: event.type, userId: event.userId };
}

// 波及処理が送信の回数などの記録の状態に依存しないよう、契約の項目だけを渡す
function toLifecycleEvent(event: StoredLifecycleEvent): UserLifecycleEvent {
  return Object.freeze({
    id: event.id,
    userId: event.userId,
    type: event.type,
    occurredAt: event.occurredAt,
  });
}

// 波及処理と物理削除の例外は捕まえずに投げ、メッセージの再試行に任せる。完了の記録は残るため、再試行は未完了の波及処理から続く
export class UserLifecycleRunner implements MessageHandler<RunUserLifecycleBody> {
  private readonly store: UserLifecycleStore;
  private readonly registry: AsyncLifecycleRegistry;
  private readonly resolver: LifecycleHandlerResolver;
  private readonly purgeStore: IdentityPurgeStore;
  private readonly clock: Clock;

  constructor(dependencies: UserLifecycleRunnerDependencies) {
    this.store = dependencies.store;
    this.registry = dependencies.registry;
    this.resolver = dependencies.resolver;
    this.purgeStore = dependencies.purgeStore;
    this.clock = dependencies.clock;
  }

  async handle(body: RunUserLifecycleBody): Promise<MessageHandlingResult> {
    const event = await this.store.findEvent(body.eventId);
    if (event === undefined) {
      logger.info('ライフサイクルイベントが見つからないため終えました', {
        eventId: body.eventId,
        outcome: 'missing',
      });
      return DONE;
    }
    const attributes = attributesOf(event);
    if (event.status === 'completed') {
      logger.info('完了済みのライフサイクルイベントのため終えました', {
        ...attributes,
        outcome: 'already-completed',
      });
      return DONE;
    }
    const oldest = await this.store.findOldestPending(event.userId);
    if (oldest !== undefined && oldest.id !== event.id) {
      logger.info('同じ利用者のより前のイベントの完了を待ちます', {
        ...attributes,
        outcome: 'waiting-for-earlier-event',
      });
      return { kind: 'defer', delaySeconds: LIFECYCLE_ORDER_WAIT_SECONDS };
    }
    const continued = await this.runHandlers(event, attributes);
    if (continued) {
      return { kind: 'defer', delaySeconds: LIFECYCLE_CONTINUE_DELAY_SECONDS };
    }
    if (event.type === 'purge_due') {
      await this.purgeStore.purge(event.userId);
    }
    await this.store.markEventCompleted(event.id, this.clock.now());
    logger.info('ライフサイクルイベントの波及処理を完了しました', {
      ...attributes,
      outcome: 'completed',
    });
    return DONE;
  }

  // 続きのある波及処理で止めた場合にtrueを返す
  private async runHandlers(
    event: StoredLifecycleEvent,
    attributes: EventLogAttributes,
  ): Promise<boolean> {
    const completed = await this.store.completedHandlers(event.id);
    const lifecycleEvent = toLifecycleEvent(event);
    for (const registration of this.registry.handlersFor(event.type)) {
      if (completed.has(registration.name)) {
        continue;
      }
      const handler = this.resolver.resolve(registration);
      const outcome = await handler.handle(lifecycleEvent);
      if (outcome.kind === 'continue') {
        logger.info('波及処理に続きがあるため後で再開します', {
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
      logger.info('波及処理を完了しました', {
        ...attributes,
        handler: registration.name,
        outcome: 'handler-completed',
      });
    }
    return false;
  }
}
