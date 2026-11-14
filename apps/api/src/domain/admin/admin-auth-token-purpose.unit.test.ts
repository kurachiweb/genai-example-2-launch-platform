import { describe, expect, expectTypeOf, test } from 'bun:test';

import {
  createKeyedHasher,
  type HashPurpose,
} from '../../../lib/core/crypto/keyed-hasher.ts';
import {
  ADMIN_AUTH_TOKEN_PURPOSES,
  ADMIN_AUTH_TOKEN_TTL_SECONDS,
  ADMIN_HASH_PURPOSES,
  type AdminAuthTokenPurpose,
} from './admin-auth-token-purpose.ts';

const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 60 * MINUTE_SECONDS;

const USER_HASH_PURPOSES = [
  'password-prehash',
  'user-session',
  'user-login-challenge',
  'user-recovery-code',
  'user-auth-token-email-verification',
  'user-auth-token-email-change',
  'user-auth-token-password-reset',
  'user-auth-token-password-change',
  'rate-limit-key',
];

const allAdminHashPurposes = (): readonly string[] => [
  ADMIN_HASH_PURPOSES.session,
  ADMIN_HASH_PURPOSES.loginChallenge,
  ADMIN_HASH_PURPOSES.recoveryCode,
  ...ADMIN_AUTH_TOKEN_PURPOSES.map((purpose) =>
    ADMIN_HASH_PURPOSES.authToken(purpose),
  ),
];

describe('ADMIN_AUTH_TOKEN_PURPOSES', () => {
  test('用途は招待・メールアドレス変更・パスワードリセットの3つで、変更できない', () => {
    expect([...ADMIN_AUTH_TOKEN_PURPOSES]).toEqual([
      'invitation',
      'email_change',
      'password_reset',
    ]);
    expect(Object.isFrozen(ADMIN_AUTH_TOKEN_PURPOSES)).toBe(true);
    expectTypeOf<AdminAuthTokenPurpose>().toEqualTypeOf<
      'invitation' | 'email_change' | 'password_reset'
    >();
  });
});

describe('ADMIN_AUTH_TOKEN_TTL_SECONDS', () => {
  test.each([
    { purpose: 'invitation', seconds: 24 * HOUR_SECONDS },
    { purpose: 'email_change', seconds: 24 * HOUR_SECONDS },
    { purpose: 'password_reset', seconds: 30 * MINUTE_SECONDS },
  ] as const)(
    '$purposeの有効期限は発行から$seconds秒である',
    ({ purpose, seconds }) => {
      expect(ADMIN_AUTH_TOKEN_TTL_SECONDS[purpose]).toBe(seconds);
    },
  );

  test('すべての用途に有効期限があり、変更できない', () => {
    expect(Object.keys(ADMIN_AUTH_TOKEN_TTL_SECONDS).toSorted()).toEqual(
      [...ADMIN_AUTH_TOKEN_PURPOSES].toSorted(),
    );
    expect(Object.isFrozen(ADMIN_AUTH_TOKEN_TTL_SECONDS)).toBe(true);
  });
});

describe('ADMIN_HASH_PURPOSES', () => {
  test('セッション・第2要素の待ち・リカバリコードのハッシュの用途は管理者の接頭辞を持つ', () => {
    expect<string>(ADMIN_HASH_PURPOSES.session).toBe('admin-session');
    expect<string>(ADMIN_HASH_PURPOSES.loginChallenge).toBe(
      'admin-login-challenge',
    );
    expect<string>(ADMIN_HASH_PURPOSES.recoveryCode).toBe(
      'admin-recovery-code',
    );
    expectTypeOf(ADMIN_HASH_PURPOSES.session).toEqualTypeOf<HashPurpose>();
  });

  test.each([
    { purpose: 'invitation', hashPurpose: 'admin-auth-token-invitation' },
    { purpose: 'email_change', hashPurpose: 'admin-auth-token-email-change' },
    {
      purpose: 'password_reset',
      hashPurpose: 'admin-auth-token-password-reset',
    },
  ] as const)(
    '$purposeのトークンのハッシュの用途は$hashPurposeである',
    ({ purpose, hashPurpose }) => {
      expect<string>(ADMIN_HASH_PURPOSES.authToken(purpose)).toBe(hashPurpose);
      expectTypeOf(
        ADMIN_HASH_PURPOSES.authToken(purpose),
      ).toEqualTypeOf<HashPurpose>();
    },
  );

  test('変更できない', () => {
    expect(Object.isFrozen(ADMIN_HASH_PURPOSES)).toBe(true);
  });

  test('ハッシュの用途は互いに異なり、利用者の部品の用途とも重ならない', () => {
    const purposes = allAdminHashPurposes();

    expect(new Set(purposes).size).toBe(purposes.length);
    for (const userPurpose of USER_HASH_PURPOSES) {
      expect(purposes).not.toContain(userPurpose);
    }
  });

  test('同じトークンでも用途が違えば別のハッシュ値になる', async () => {
    const hasher = createKeyedHasher(['unit', 'test', 'pepper'].join('-'));
    const token = ['same', 'token', 'value'].join('-');

    const hashes = await Promise.all(
      ADMIN_AUTH_TOKEN_PURPOSES.map((purpose) =>
        hasher.hash(ADMIN_HASH_PURPOSES.authToken(purpose), token),
      ),
    );

    expect(new Set(hashes).size).toBe(ADMIN_AUTH_TOKEN_PURPOSES.length);
  });
});
