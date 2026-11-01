import { EMAIL_SEND_MESSAGE } from '../../email/send-message.ts';
import {
  MODERATE_IMAGE_MESSAGE,
  PURGE_IMAGE_CACHE_MESSAGE,
  RELOCATE_FILES_MESSAGE,
} from '../../media/media-messages.ts';
import type { MessageContract } from '../message-contract.ts';
import { SEARCH_INDEX_REFRESH_MESSAGE } from './search-index-refresh.ts';

export const MESSAGE_CONTRACTS: readonly MessageContract<string, unknown>[] =
  Object.freeze([
    EMAIL_SEND_MESSAGE,
    SEARCH_INDEX_REFRESH_MESSAGE,
    MODERATE_IMAGE_MESSAGE,
    RELOCATE_FILES_MESSAGE,
    PURGE_IMAGE_CACHE_MESSAGE,
  ]);
