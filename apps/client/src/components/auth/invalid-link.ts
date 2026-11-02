import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';

const INVALID_LINK_CODE = 'invalid_link';

const VALIDATION_ERROR_CODE = 'validation_error';

const TOKEN_FIELDS: ReadonlySet<string> = new Set(['token', 'input.token']);

// 照合できないトークンはinvalid_link、長すぎるトークンは入力の検証でtokenの欄の詳細として拒否されるため、どちらも無効なリンクとして示す
export const isInvalidLinkError = (error: unknown): boolean =>
  error instanceof GraphQLClientError &&
  (error.code === INVALID_LINK_CODE ||
    (error.code === VALIDATION_ERROR_CODE &&
      (error.details ?? []).some(({ field }) => TOKEN_FIELDS.has(field))));
