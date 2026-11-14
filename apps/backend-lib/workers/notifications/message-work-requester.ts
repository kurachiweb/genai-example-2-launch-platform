import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import {
  EXPAND_NOTIFICATION_EVENT_MESSAGE,
  FLUSH_NOTIFICATION_SLOT_MESSAGE,
} from '../../core/messaging/contracts/notifications.ts';
import type { NotificationWorkRequester } from '../../core/notifications/ports.ts';
import type { MessagePublisher } from '../messaging/queue-publisher.ts';

@injectable()
export class MessageWorkRequester implements NotificationWorkRequester {
  constructor(
    @inject(PLATFORM_TYPES.MessagePublisher)
    private readonly publisher: MessagePublisher,
  ) {}

  async flushSlot(slotKey: string, delaySeconds: number): Promise<void> {
    await this.publisher.publish(
      FLUSH_NOTIFICATION_SLOT_MESSAGE,
      { slotKey },
      { delaySeconds },
    );
  }

  async expandEvent(eventId: string): Promise<void> {
    await this.publisher.publish(EXPAND_NOTIFICATION_EVENT_MESSAGE, {
      eventId,
    });
  }
}
