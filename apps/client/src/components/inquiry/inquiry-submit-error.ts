import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';

export interface InquirySubmitErrorView {
  readonly message: string;
  // 送信の回数の上限を超えた時の、再度送信できる日時
  readonly retryAt?: Date;
}

const RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded';

const MILLISECONDS_PER_SECOND = 1000;

export const inquirySubmitErrorOf = (
  error: unknown,
  now: Date = new Date(),
): InquirySubmitErrorView => {
  const message = errorMessageOf(error, CLIENT_PROFILE.contactAvailable);
  if (
    error instanceof GraphQLClientError &&
    error.code === RATE_LIMIT_EXCEEDED &&
    error.retryAfterSeconds !== undefined
  ) {
    return {
      message,
      retryAt: new Date(
        now.getTime() + error.retryAfterSeconds * MILLISECONDS_PER_SECOND,
      ),
    };
  }
  return { message };
};
