import type { RawQueueRegistration } from '../../lib/core/messaging/raw-queue.ts';
import { EVENT_EMAIL_TYPES } from '../application/email/email-types.ts';
import type { EventEnv } from './env-schema.ts';

export const RAW_QUEUE_HANDLERS: readonly RawQueueRegistration<EventEnv>[] =
  Object.freeze([
    {
      name: 'email-delivery-events',
      queueName: (env) => env.EMAIL_EVENTS_QUEUE_NAME,
      handler: EVENT_EMAIL_TYPES.DeliveryEventHandler,
    },
  ]);
