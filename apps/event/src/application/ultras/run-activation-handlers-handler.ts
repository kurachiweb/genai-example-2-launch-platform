import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type {
  MessageHandler,
  MessageHandlingResult,
} from '../../../lib/core/messaging/message-contract.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type {
  UltrasActivation,
  UltrasActivationHandler,
  UltrasActivationHandlerRegistration,
} from '../../../lib/core/ultras/activation-contract.ts';
import type { RunActivationHandlersBody } from '../../../lib/core/ultras/activation-message.ts';
import type {
  ActivationStore,
  UltrasActivationRow,
} from '../../../lib/core/ultras/ports.ts';

// 知らせの処理は加入を受け取る各機能のモジュールが束縛するため、合成ルートが処理単位のコンテナから解決する関数を渡す
export interface ActivationHandlerResolver {
  resolve(
    registration: UltrasActivationHandlerRegistration,
  ): UltrasActivationHandler;
}

export interface RunActivationHandlersHandlerDependencies {
  readonly activations: ActivationStore;
  readonly registry: readonly UltrasActivationHandlerRegistration[];
  readonly resolver: ActivationHandlerResolver;
  readonly clock: Clock;
}

type ActivationLogAttributes = Readonly<{
  activationId: string;
  userId: string;
  stripeSubscriptionId: string;
}>;

const DONE: MessageHandlingResult = Object.freeze({ kind: 'done' });

const logger = getAppLogger(['event', 'ultras', 'activation']);

function attributesOf(row: UltrasActivationRow): ActivationLogAttributes {
  return {
    activationId: row.id,
    userId: row.userId,
    stripeSubscriptionId: row.stripeSubscriptionId,
  };
}

// 処理が送り出しや完了の記録の状態に依存しないよう、契約の項目だけを渡す
function toActivation(row: UltrasActivationRow): UltrasActivation {
  return Object.freeze({
    activationId: row.id,
    userId: row.userId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    activatedAt: row.activatedAt,
  });
}

// 処理の例外は捕まえずに投げ、メッセージの再試行に任せる。完了はすべての処理が成功したときだけ記録するため、再試行はすべての処理を呼び直す(処理側は冪等)
export class RunActivationHandlersHandler implements MessageHandler<RunActivationHandlersBody> {
  private readonly activations: ActivationStore;
  private readonly registry: readonly UltrasActivationHandlerRegistration[];
  private readonly resolver: ActivationHandlerResolver;
  private readonly clock: Clock;

  constructor(dependencies: RunActivationHandlersHandlerDependencies) {
    this.activations = dependencies.activations;
    this.registry = dependencies.registry;
    this.resolver = dependencies.resolver;
    this.clock = dependencies.clock;
  }

  async handle(
    body: RunActivationHandlersBody,
  ): Promise<MessageHandlingResult> {
    const row = await this.activations.findById(body.activationId);
    if (row === undefined) {
      logger.info('加入が有効になった知らせが見つからないため終えました', {
        activationId: body.activationId,
        outcome: 'missing',
      });
      return DONE;
    }
    const attributes = attributesOf(row);
    if (row.completedAt !== null) {
      logger.info('完了済みの加入が有効になった知らせのため終えました', {
        ...attributes,
        outcome: 'already-completed',
      });
      return DONE;
    }
    const activation = toActivation(row);
    for (const registration of this.registry) {
      await this.resolver.resolve(registration).handle(activation);
      logger.info('加入が有効になった知らせの処理を終えました', {
        ...attributes,
        handler: registration.name,
        outcome: 'handler-completed',
      });
    }
    await this.activations.markCompleted(row.id, this.clock.now());
    logger.info('加入が有効になった知らせの処理をすべて終えました', {
      ...attributes,
      handlers: this.registry.length,
      outcome: 'completed',
    });
    return DONE;
  }
}
