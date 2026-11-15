import { LIFECYCLE_CONTINUE_DELAY_SECONDS } from '../../../lib/core/identity/user-lifecycle.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { RunProductLifecycleBody } from '../../../lib/core/messaging/contracts/product.ts';
import type {
  MessageHandler,
  MessageHandlingResult,
} from '../../../lib/core/messaging/message-contract.ts';
import type {
  ProductLifecycleStore,
  StoredProductLifecycleEvent,
} from '../../../lib/core/product/ports.ts';
import type {
  ProductLifecycleEvent,
  ProductLifecycleRegistry,
} from '../../../lib/core/product/product-lifecycle.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type {
  ProductLifecycleHandlerResolver,
  ProductPurgeStore,
} from './ports.ts';

export const PRODUCT_LIFECYCLE_ORDER_WAIT_SECONDS = 60;

export interface ProductLifecycleRunnerDependencies {
  readonly store: ProductLifecycleStore;
  readonly registry: ProductLifecycleRegistry;
  readonly resolver: ProductLifecycleHandlerResolver;
  readonly purgeStore: ProductPurgeStore;
  readonly clock: Clock;
}

type EventLogAttributes = Readonly<{
  eventId: string;
  type: string;
  productId: string;
}>;

const DONE: MessageHandlingResult = Object.freeze({ kind: 'done' });

const logger = getAppLogger(['event', 'product', 'lifecycle']);

function attributesOf(event: StoredProductLifecycleEvent): EventLogAttributes {
  return { eventId: event.id, type: event.type, productId: event.productId };
}

// 処理が送信の回数などの記録の状態に依存しないよう、契約の項目だけを渡す
function toLifecycleEvent(
  event: StoredProductLifecycleEvent,
): ProductLifecycleEvent {
  return Object.freeze({
    id: event.id,
    productId: event.productId,
    ownerUserId: event.ownerUserId,
    type: event.type,
    occurredAt: event.occurredAt,
  });
}

// 処理と物理削除の例外は捕まえずに投げ、メッセージの再試行に任せる。完了の記録は残るため、再試行は未完了の処理から続く
export class ProductLifecycleRunner implements MessageHandler<RunProductLifecycleBody> {
  private readonly store: ProductLifecycleStore;
  private readonly registry: ProductLifecycleRegistry;
  private readonly resolver: ProductLifecycleHandlerResolver;
  private readonly purgeStore: ProductPurgeStore;
  private readonly clock: Clock;

  constructor(dependencies: ProductLifecycleRunnerDependencies) {
    this.store = dependencies.store;
    this.registry = dependencies.registry;
    this.resolver = dependencies.resolver;
    this.purgeStore = dependencies.purgeStore;
    this.clock = dependencies.clock;
  }

  async handle(body: RunProductLifecycleBody): Promise<MessageHandlingResult> {
    const event = await this.store.findEvent(body.eventId);
    if (event === undefined) {
      logger.info(
        'プロダクトライフサイクルイベントが見つからないため終えました',
        { eventId: body.eventId, outcome: 'missing' },
      );
      return DONE;
    }
    const attributes = attributesOf(event);
    if (event.status === 'completed') {
      logger.info(
        '完了済みのプロダクトライフサイクルイベントのため終えました',
        { ...attributes, outcome: 'already-completed' },
      );
      return DONE;
    }
    const oldest = await this.store.findOldestPending(event.productId);
    if (oldest !== undefined && oldest.id !== event.id) {
      logger.info('同じプロダクトのより前のイベントの完了を待ちます', {
        ...attributes,
        outcome: 'waiting-for-earlier-event',
      });
      return {
        kind: 'defer',
        delaySeconds: PRODUCT_LIFECYCLE_ORDER_WAIT_SECONDS,
      };
    }
    const continued = await this.runHandlers(event, attributes);
    if (continued) {
      return { kind: 'defer', delaySeconds: LIFECYCLE_CONTINUE_DELAY_SECONDS };
    }
    // 物理削除はイベントと処理の記録も消すため、完了の記録を書かない
    if (event.type === 'purge_due') {
      await this.purgeStore.purge(event.productId);
      logger.info('プロダクトを物理削除しました', {
        ...attributes,
        outcome: 'purged',
      });
      return DONE;
    }
    await this.store.markEventCompleted(event.id, this.clock.now());
    logger.info('プロダクトライフサイクルイベントの処理を完了しました', {
      ...attributes,
      outcome: 'completed',
    });
    return DONE;
  }

  // 続きのある処理で止めた場合にtrueを返す
  private async runHandlers(
    event: StoredProductLifecycleEvent,
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
