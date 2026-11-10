import type { Logger } from '@logtape/logtape';

import { getAppLogger } from '../../core/logging/app-logger.ts';
import type { MatchEventDispatcher } from '../../core/match/ports.ts';
import { RUN_MATCH_EVENT_MESSAGE } from '../../core/messaging/contracts/match.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import type { MessagePublisher } from '../messaging/queue-publisher.ts';

// Workersの1回の起動で同時に開ける接続の上限で、Queuesへの送信もこれに数えられる
export const MATCH_EVENT_PUBLISH_CONCURRENCY = 6;

export class QueueMatchEventDispatcher implements MatchEventDispatcher {
  private readonly logger: Logger;

  constructor(
    private readonly publisher: MessagePublisher,
    appName: LoggingOptions['appName'],
  ) {
    this.logger = getAppLogger([appName, 'match', 'events']);
  }

  // 送れなかったイベントはpendingのまま残り、次のジョブの先頭の掃き出しと4:21の送り直しが拾うため、呼び出し側の処理を止めない
  async publish(eventIds: readonly string[]): Promise<void> {
    const queue = [...new Set(eventIds)];
    const worker = async (): Promise<void> => {
      for (
        let eventId = queue.shift();
        eventId !== undefined;
        eventId = queue.shift()
      ) {
        await this.publishOne(eventId);
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(MATCH_EVENT_PUBLISH_CONCURRENCY, queue.length) },
        worker,
      ),
    );
  }

  private async publishOne(eventId: string): Promise<void> {
    try {
      await this.publisher.publish(RUN_MATCH_EVENT_MESSAGE, { eventId });
    } catch (error) {
      this.logger.warn('マッチイベントを送れず、送り直しに委ねました', {
        eventId,
        error,
      });
    }
  }
}
