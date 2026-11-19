import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { API_KEY_FORM_MESSAGES } from './api-key-form-messages.ts';

const TOO_MANY_REQUESTS = 429;

// 発行の回数の上限(再発行を含む)は、APIサーバーの文言ではなく文言規則のレート制限の文言で示す
export const apiKeyFailureMessageOf = (error: unknown): string =>
  error instanceof GraphQLClientError && error.status === TOO_MANY_REQUESTS
    ? API_KEY_FORM_MESSAGES.rateLimited
    : errorMessageOf(error, CLIENT_PROFILE.contactAvailable);
