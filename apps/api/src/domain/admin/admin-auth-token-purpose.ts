import {
  type HashPurpose,
  hashPurpose,
} from '../../../lib/core/crypto/keyed-hasher.ts';

export const ADMIN_AUTH_TOKEN_PURPOSES = Object.freeze([
  'invitation',
  'email_change',
  'password_reset',
] as const);

export type AdminAuthTokenPurpose = (typeof ADMIN_AUTH_TOKEN_PURPOSES)[number];

const HOUR_SECONDS = 60 * 60;

const MINUTE_SECONDS = 60;

export const ADMIN_AUTH_TOKEN_TTL_SECONDS: Readonly<
  Record<AdminAuthTokenPurpose, number>
> = Object.freeze({
  invitation: 24 * HOUR_SECONDS,
  email_change: 24 * HOUR_SECONDS,
  password_reset: 30 * MINUTE_SECONDS,
});

const AUTH_TOKEN_HASH_PURPOSES: Readonly<
  Record<AdminAuthTokenPurpose, HashPurpose>
> = Object.freeze({
  invitation: hashPurpose('admin-auth-token-invitation'),
  email_change: hashPurpose('admin-auth-token-email-change'),
  password_reset: hashPurpose('admin-auth-token-password-reset'),
});

export interface AdminHashPurposes {
  readonly session: HashPurpose;
  readonly loginChallenge: HashPurpose;
  readonly recoveryCode: HashPurpose;
  readonly authToken: (purpose: AdminAuthTokenPurpose) => HashPurpose;
}

// 保存を始めた用途の名前を変えると保存済みのハッシュ値と一致しなくなるため、名前は変えない
export const ADMIN_HASH_PURPOSES: AdminHashPurposes = Object.freeze({
  session: hashPurpose('admin-session'),
  loginChallenge: hashPurpose('admin-login-challenge'),
  recoveryCode: hashPurpose('admin-recovery-code'),
  authToken: (purpose: AdminAuthTokenPurpose): HashPurpose =>
    AUTH_TOKEN_HASH_PURPOSES[purpose],
});
