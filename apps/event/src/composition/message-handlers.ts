import { EMAIL_SEND_RETRY_POLICY } from '../../lib/core/email/delivery-decision.ts';
import { EMAIL_SEND_MESSAGE } from '../../lib/core/email/send-message.ts';
import type { MessageHandlerRegistration } from '../../lib/core/messaging/message-contract.ts';
import { EVENT_EMAIL_TYPES } from '../application/email/email-types.ts';

export const MESSAGE_HANDLERS: readonly MessageHandlerRegistration<unknown>[] =
  Object.freeze([
    {
      contract: EMAIL_SEND_MESSAGE,
      handler: EVENT_EMAIL_TYPES.SendEmailHandler,
      retry: EMAIL_SEND_RETRY_POLICY,
    },
  ]);
