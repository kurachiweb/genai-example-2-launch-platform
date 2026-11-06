import { EMAIL_SEND_RETRY_POLICY } from '../../lib/core/email/delivery-decision.ts';
import { EMAIL_SEND_MESSAGE } from '../../lib/core/email/send-message.ts';
import {
  MODERATE_IMAGE_MESSAGE,
  PURGE_IMAGE_CACHE_MESSAGE,
  RELOCATE_FILES_MESSAGE,
} from '../../lib/core/media/media-messages.ts';
import {
  SEARCH_INDEX_REFRESH_MESSAGE,
  SEARCH_INDEX_REFRESH_RETRY,
} from '../../lib/core/messaging/contracts/search-index-refresh.ts';
import { USER_LIFECYCLE_RETRY_POLICY } from '../../lib/core/identity/user-lifecycle.ts';
import {
  RECHECK_DISPOSABLE_EMAIL_MESSAGE,
  RUN_USER_LIFECYCLE_MESSAGE,
} from '../../lib/core/messaging/contracts/identity.ts';
import type { MessageHandlerRegistration } from '../../lib/core/messaging/message-contract.ts';
import { PAYMENTS_REFUND_MESSAGE } from '../../lib/core/payments/refund-message.ts';
import { SEARCH_TYPES } from '../../lib/core/search/identifiers.ts';
import { EVENT_EMAIL_TYPES } from '../application/email/email-types.ts';
import { EVENT_IDENTITY_TYPES } from '../application/identity/event-identity-types.ts';
import { EVENT_MEDIA_HANDLER_TYPES } from '../application/media/media-handler-types.ts';
import { MODERATION_RETRY_POLICY } from '../application/media/moderate-image-handler.ts';
import { PURGE_IMAGE_CACHE_RETRY_POLICY } from '../application/media/purge-image-cache-handler.ts';
import { EVENT_PAYMENTS_TYPES } from '../application/payments/event-payments-types.ts';
import { REFUND_PAYMENT_RETRY_POLICY } from '../application/payments/refund-payment-handler.ts';

export const MESSAGE_HANDLERS: readonly MessageHandlerRegistration<unknown>[] =
  Object.freeze([
    {
      contract: EMAIL_SEND_MESSAGE,
      handler: EVENT_EMAIL_TYPES.SendEmailHandler,
      retry: EMAIL_SEND_RETRY_POLICY,
    },
    {
      contract: SEARCH_INDEX_REFRESH_MESSAGE,
      handler: SEARCH_TYPES.RefreshHandler,
      retry: SEARCH_INDEX_REFRESH_RETRY,
    },
    {
      contract: MODERATE_IMAGE_MESSAGE,
      handler: EVENT_MEDIA_HANDLER_TYPES.ModerateImageHandler,
      retry: MODERATION_RETRY_POLICY,
    },
    {
      contract: RELOCATE_FILES_MESSAGE,
      handler: EVENT_MEDIA_HANDLER_TYPES.RelocateFilesHandler,
    },
    {
      contract: PURGE_IMAGE_CACHE_MESSAGE,
      handler: EVENT_MEDIA_HANDLER_TYPES.PurgeImageCacheHandler,
      retry: PURGE_IMAGE_CACHE_RETRY_POLICY,
    },
    {
      contract: RUN_USER_LIFECYCLE_MESSAGE,
      handler: EVENT_IDENTITY_TYPES.UserLifecycleRunner,
      retry: USER_LIFECYCLE_RETRY_POLICY,
    },
    {
      contract: RECHECK_DISPOSABLE_EMAIL_MESSAGE,
      handler: EVENT_IDENTITY_TYPES.DisposableEmailRecheckHandler,
    },
    {
      contract: PAYMENTS_REFUND_MESSAGE,
      handler: EVENT_PAYMENTS_TYPES.RefundPaymentHandler,
      retry: REFUND_PAYMENT_RETRY_POLICY,
    },
  ]);
