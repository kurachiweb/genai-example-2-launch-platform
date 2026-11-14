import { z } from 'zod';

import { parseSlotKey } from '../../notifications/notification-slots.ts';
import {
  defineMessageContract,
  type MessageContract,
} from '../message-contract.ts';
import type { RetryPolicy } from '../retry-policy.ts';

export interface FlushNotificationSlotBody {
  readonly slotKey: string;
}

export interface ExpandNotificationEventBody {
  readonly eventId: string;
}

// デッドレターや再試行で本文が運ばれ続けるため、宛先や名称を入れず、受信側が記録を読み直すキーとIDだけを持たせる
const flushNotificationSlotBodySchema = z.object({
  slotKey: z.string().refine((key) => parseSlotKey(key) !== undefined),
});

// 受賞の枠のキーは採番の表記の大文字のIDから作るため、同じ表記だけを受け付ける
const expandNotificationEventBodySchema = z.object({
  eventId: z.ulid().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/u),
});

export const FLUSH_NOTIFICATION_SLOT_MESSAGE: MessageContract<
  'notifications.flush-slot',
  FlushNotificationSlotBody
> = defineMessageContract(
  'notifications.flush-slot',
  flushNotificationSlotBodySchema,
);

export const EXPAND_NOTIFICATION_EVENT_MESSAGE: MessageContract<
  'notifications.expand-event',
  ExpandNotificationEventBody
> = defineMessageContract(
  'notifications.expand-event',
  expandNotificationEventBodySchema,
);

export const NOTIFICATION_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 5,
  baseDelaySeconds: 60,
  maxDelaySeconds: 1800,
});

export const NOTIFICATION_CONTINUE_DELAY_SECONDS = 1;
