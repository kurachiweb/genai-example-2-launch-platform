import type { Logger } from '@logtape/logtape';

import { getAppLogger } from '../../core/logging/app-logger.ts';
import type { Clock } from '../../core/time/clock.ts';
import { ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE } from '../../core/ultras/activation-message.ts';
import type {
  ActivationDispatcher,
  ActivationStore,
} from '../../core/ultras/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import type { MessagePublisher } from '../messaging/queue-publisher.ts';

export interface QueueActivationDispatcherDependencies {
  readonly appName: LoggingOptions['appName'];
  readonly publisher: MessagePublisher;
  readonly activations: ActivationStore;
  readonly clock: Clock;
}

type DispatchStage = 'publish' | 'mark_dispatched';

const DISPATCH_FAILURE_MESSAGES: Readonly<Record<DispatchStage, string>> = {
  publish: '加入が有効になった知らせを送り出せず、日次の確認に委ねました',
  mark_dispatched:
    '加入が有効になった知らせの送り出しを記録できず、日次の確認に委ねました',
};

export class QueueActivationDispatcher implements ActivationDispatcher {
  private readonly publisher: MessagePublisher;
  private readonly activations: ActivationStore;
  private readonly clock: Clock;
  private readonly logger: Logger;

  constructor(dependencies: QueueActivationDispatcherDependencies) {
    this.publisher = dependencies.publisher;
    this.activations = dependencies.activations;
    this.clock = dependencies.clock;
    this.logger = getAppLogger([dependencies.appName, 'application', 'ultras']);
  }

  // 送り出しも記録も、失敗した知らせは日次の確認が送り直す(処理側は冪等)ため、呼び出し側の処理を止めない
  async dispatch(activationId: string): Promise<void> {
    const published = await this.attempt('publish', activationId, () =>
      this.publisher.publish(ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE, {
        activationId,
      }),
    );
    if (!published) {
      return;
    }
    await this.attempt('mark_dispatched', activationId, () =>
      this.activations.markDispatched(activationId, this.clock.now()),
    );
  }

  private async attempt(
    stage: DispatchStage,
    activationId: string,
    task: () => Promise<unknown>,
  ): Promise<boolean> {
    try {
      await task();
      return true;
    } catch (error) {
      this.logger.warn(DISPATCH_FAILURE_MESSAGES[stage], {
        activationId,
        stage,
        error,
      });
      return false;
    }
  }
}
