import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import {
  SPONSORSHIP_DISPATCH_NOTICES_MESSAGE,
  SPONSORSHIP_SETTLE_PERIOD_END_MESSAGE,
} from '../../core/messaging/contracts/sponsorship.ts';
import type { NoticeRequester } from '../../core/sponsorship/ports.ts';
import type { Clock } from '../../core/time/clock.ts';
import type { MessagePublisher } from '../messaging/queue-publisher.ts';

@injectable()
export class QueueNoticeRequester implements NoticeRequester {
  constructor(
    @inject(PLATFORM_TYPES.MessagePublisher)
    private readonly publisher: MessagePublisher,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async request(): Promise<void> {
    await this.publisher.publish(SPONSORSHIP_DISPATCH_NOTICES_MESSAGE, {
      requestedAt: this.clock.now().toISOString(),
    });
  }

  async requestSettlement(): Promise<void> {
    await this.publisher.publish(SPONSORSHIP_SETTLE_PERIOD_END_MESSAGE, {
      requestedAt: this.clock.now().toISOString(),
    });
  }
}
