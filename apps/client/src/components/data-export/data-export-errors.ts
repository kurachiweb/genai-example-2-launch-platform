import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  DATA_EXPORT_EMAIL_NOT_VERIFIED_MESSAGE,
  DATA_EXPORT_REQUEST_FAILED_MESSAGE,
} from './data-export-messages.ts';

export type DataExportRequestErrorView =
  | {
      readonly kind: 'rate_limited';
      // 再び要求できる日時
      readonly retryAt: Date;
    }
  | { readonly kind: 'message'; readonly message: string };

const RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded';

const EMAIL_NOT_VERIFIED = 'email_not_verified';

const UNAVAILABLE = 'data_export_unavailable';

const MILLISECONDS_PER_SECOND = 1000;

const messageOf = (message: string): DataExportRequestErrorView => ({
  kind: 'message',
  message,
});

// 想定外の失敗と例外の内容は利用者へ見せず、通信の失敗の文言にまとめる。想定外の失敗のエラートラッキングへの送信は`executeGraphQL`が行う
export const dataExportRequestErrorOf = (
  error: unknown,
  now: Date = new Date(),
): DataExportRequestErrorView => {
  if (!(error instanceof GraphQLClientError)) {
    return messageOf(DATA_EXPORT_REQUEST_FAILED_MESSAGE);
  }
  if (
    error.code === RATE_LIMIT_EXCEEDED &&
    error.retryAfterSeconds !== undefined
  ) {
    return {
      kind: 'rate_limited',
      retryAt: new Date(
        now.getTime() + error.retryAfterSeconds * MILLISECONDS_PER_SECOND,
      ),
    };
  }
  if (error.code === EMAIL_NOT_VERIFIED) {
    return messageOf(DATA_EXPORT_EMAIL_NOT_VERIFIED_MESSAGE);
  }
  if (!error.expected || error.code === UNAVAILABLE) {
    return messageOf(DATA_EXPORT_REQUEST_FAILED_MESSAGE);
  }
  return messageOf(error.message);
};
