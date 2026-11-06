import { EMAIL_SEND_MESSAGE } from '../../email/send-message.ts';
import {
  MODERATE_IMAGE_MESSAGE,
  PURGE_IMAGE_CACHE_MESSAGE,
  RELOCATE_FILES_MESSAGE,
} from '../../media/media-messages.ts';
import { PAYMENTS_REFUND_MESSAGE } from '../../payments/refund-message.ts';
import { ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE } from '../../ultras/activation-message.ts';
import type { MessageContract } from '../message-contract.ts';
import {
  RECHECK_DISPOSABLE_EMAIL_MESSAGE,
  RUN_USER_LIFECYCLE_MESSAGE,
} from './identity.ts';
import { SEARCH_INDEX_REFRESH_MESSAGE } from './search-index-refresh.ts';

export const MESSAGE_CONTRACTS: readonly MessageContract<string, unknown>[] =
  Object.freeze([
    EMAIL_SEND_MESSAGE,
    SEARCH_INDEX_REFRESH_MESSAGE,
    MODERATE_IMAGE_MESSAGE,
    RELOCATE_FILES_MESSAGE,
    PURGE_IMAGE_CACHE_MESSAGE,
    RUN_USER_LIFECYCLE_MESSAGE,
    RECHECK_DISPOSABLE_EMAIL_MESSAGE,
    PAYMENTS_REFUND_MESSAGE,
    ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE,
  ]);
