import {
  type HashPurpose,
  hashPurpose,
} from '../../../lib/core/crypto/keyed-hasher.ts';

export const API_KEY_TOKEN_PREFIX = 'lsk_';

export const API_KEY_TOKEN_PATTERN = /^lsk_[A-Za-z0-9_-]{43}$/;

// 保存を始めた用途の名前を変えると保存済みのハッシュ値と一致しなくなるため、名前は変えない
export const API_KEY_HASH_PURPOSE: HashPurpose = hashPurpose('public-api-key');

export type BearerParseResult =
  | { readonly kind: 'token'; readonly token: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'malformed' };

// RFC 6750の`credentials = "Bearer" 1*SP b64token`に倣い、方式名は大文字小文字を区別しない
const BEARER_CREDENTIALS = /^Bearer +(\S+)$/i;

export const parseBearerAuthorization = (
  header: string | undefined,
): BearerParseResult => {
  if (header === undefined) {
    return { kind: 'missing' };
  }
  const token = BEARER_CREDENTIALS.exec(header)?.[1];
  return token === undefined ? { kind: 'malformed' } : { kind: 'token', token };
};

export const isWellFormedApiKey = (token: string): boolean =>
  API_KEY_TOKEN_PATTERN.test(token);
