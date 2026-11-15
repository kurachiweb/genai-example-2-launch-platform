import {
  type HashPurpose,
  hashPurpose,
} from '../../../lib/core/crypto/keyed-hasher.ts';

export const AUTH_TOKEN_PURPOSES = Object.freeze([
  'email_verification',
  'email_change',
  'password_reset',
  'password_change',
] as const);

export type AuthTokenPurpose = (typeof AUTH_TOKEN_PURPOSES)[number];

const HOUR_SECONDS = 60 * 60;

const MINUTE_SECONDS = 60;

export const AUTH_TOKEN_TTL_SECONDS: Readonly<
  Record<AuthTokenPurpose, number>
> = Object.freeze({
  email_verification: 24 * HOUR_SECONDS,
  email_change: 24 * HOUR_SECONDS,
  password_reset: 30 * MINUTE_SECONDS,
  password_change: 30 * MINUTE_SECONDS,
});

// 保存を始めた用途の名前を変えると保存済みのハッシュ値と一致しなくなるため、名前は変えない
export const AUTH_TOKEN_HASH_PURPOSES: Readonly<
  Record<AuthTokenPurpose, HashPurpose>
> = Object.freeze({
  email_verification: hashPurpose('user-auth-token-email-verification'),
  email_change: hashPurpose('user-auth-token-email-change'),
  password_reset: hashPurpose('user-auth-token-password-reset'),
  password_change: hashPurpose('user-auth-token-password-change'),
});

export type CompletingAuthTokenPurpose = Exclude<
  AuthTokenPurpose,
  'email_verification'
>;

export const AUTH_TOKEN_PURPOSES_REVOKED_ON_COMPLETION: Readonly<
  Record<CompletingAuthTokenPurpose, readonly AuthTokenPurpose[]>
> = Object.freeze({
  password_reset: Object.freeze(['password_reset', 'password_change'] as const),
  email_change: Object.freeze(['email_verification', 'email_change'] as const),
  password_change: Object.freeze(['password_change'] as const),
});
