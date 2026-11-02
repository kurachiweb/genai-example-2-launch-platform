import { describe, expect, expectTypeOf, test } from 'bun:test';

import {
  createKeyedHasher,
  type HashPurpose,
} from '../../../lib/core/crypto/keyed-hasher.ts';
import {
  AUTH_TOKEN_HASH_PURPOSES,
  AUTH_TOKEN_PURPOSES,
  AUTH_TOKEN_PURPOSES_REVOKED_ON_COMPLETION,
  AUTH_TOKEN_TTL_SECONDS,
  type AuthTokenPurpose,
} from './auth-token-purpose.ts';

const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 60 * MINUTE_SECONDS;

const OTHER_HASH_PURPOSES = [
  'password-prehash',
  'user-session',
  'user-login-challenge',
  'user-recovery-code',
  'rate-limit-key',
];

describe('AUTH_TOKEN_PURPOSES', () => {
  test('用途はメールアドレスの確認・変更とパスワードのリセット・変更の4つで、変更できない', () => {
    expect(AUTH_TOKEN_PURPOSES).toEqual([
      'email_verification',
      'email_change',
      'password_reset',
      'password_change',
    ]);
    expect(Object.isFrozen(AUTH_TOKEN_PURPOSES)).toBe(true);
    expectTypeOf<AuthTokenPurpose>().toEqualTypeOf<
      | 'email_verification'
      | 'email_change'
      | 'password_reset'
      | 'password_change'
    >();
  });
});

describe('AUTH_TOKEN_TTL_SECONDS', () => {
  test.each([
    { purpose: 'email_verification', seconds: 24 * HOUR_SECONDS },
    { purpose: 'email_change', seconds: 24 * HOUR_SECONDS },
    { purpose: 'password_reset', seconds: 30 * MINUTE_SECONDS },
    { purpose: 'password_change', seconds: 30 * MINUTE_SECONDS },
  ] as const)(
    '$purposeの有効期限は発行から$seconds秒である',
    ({ purpose, seconds }) => {
      expect(AUTH_TOKEN_TTL_SECONDS[purpose]).toBe(seconds);
    },
  );

  test('すべての用途に有効期限があり、変更できない', () => {
    expect(Object.keys(AUTH_TOKEN_TTL_SECONDS).toSorted()).toEqual(
      [...AUTH_TOKEN_PURPOSES].toSorted(),
    );
    expect(Object.isFrozen(AUTH_TOKEN_TTL_SECONDS)).toBe(true);
  });
});

describe('AUTH_TOKEN_HASH_PURPOSES', () => {
  test.each([
    {
      purpose: 'email_verification',
      hashPurpose: 'user-auth-token-email-verification',
    },
    { purpose: 'email_change', hashPurpose: 'user-auth-token-email-change' },
    {
      purpose: 'password_reset',
      hashPurpose: 'user-auth-token-password-reset',
    },
    {
      purpose: 'password_change',
      hashPurpose: 'user-auth-token-password-change',
    },
  ] as const)(
    '$purposeのハッシュの用途は$hashPurposeである',
    ({ purpose, hashPurpose }) => {
      expect<string>(AUTH_TOKEN_HASH_PURPOSES[purpose]).toBe(hashPurpose);
    },
  );

  test('すべての用途にハッシュの用途があり、変更できない', () => {
    expect(Object.keys(AUTH_TOKEN_HASH_PURPOSES).toSorted()).toEqual(
      [...AUTH_TOKEN_PURPOSES].toSorted(),
    );
    expect(Object.isFrozen(AUTH_TOKEN_HASH_PURPOSES)).toBe(true);
    expectTypeOf(AUTH_TOKEN_HASH_PURPOSES).toEqualTypeOf<
      Readonly<Record<AuthTokenPurpose, HashPurpose>>
    >();
  });

  test('ハッシュの用途は英小文字とハイフンだけから成り、利用者の接頭辞で始まる', () => {
    for (const hashPurpose of Object.values(AUTH_TOKEN_HASH_PURPOSES)) {
      expect(hashPurpose).toMatch(/^user-auth-token(?:-[a-z]+)+$/);
    }
  });

  test('ハッシュの用途は互いに異なり、他の部品の用途とも重ならない', () => {
    const purposes: readonly string[] = Object.values(AUTH_TOKEN_HASH_PURPOSES);

    expect(new Set(purposes).size).toBe(AUTH_TOKEN_PURPOSES.length);
    for (const other of OTHER_HASH_PURPOSES) {
      expect(purposes).not.toContain(other);
    }
  });

  test('同じトークンでも用途が違えば別のハッシュ値になる', async () => {
    const hasher = createKeyedHasher(['unit', 'test', 'pepper'].join('-'));
    const token = ['same', 'token', 'value'].join('-');

    const hashes = await Promise.all(
      AUTH_TOKEN_PURPOSES.map((purpose) =>
        hasher.hash(AUTH_TOKEN_HASH_PURPOSES[purpose], token),
      ),
    );

    expect(new Set(hashes).size).toBe(AUTH_TOKEN_PURPOSES.length);
  });
});

describe('AUTH_TOKEN_PURPOSES_REVOKED_ON_COMPLETION', () => {
  test.each([
    {
      completed: 'password_reset',
      revoked: ['password_reset', 'password_change'],
    },
    {
      completed: 'email_change',
      revoked: ['email_verification', 'email_change'],
    },
    { completed: 'password_change', revoked: ['password_change'] },
  ] as const)(
    '$completedの確定で$revokedの未使用のトークンを失効させる',
    ({ completed, revoked }) => {
      expect(AUTH_TOKEN_PURPOSES_REVOKED_ON_COMPLETION[completed]).toEqual(
        revoked,
      );
    },
  );

  test('確定で他のトークンを失効させる操作は3つで、変更できない', () => {
    expect(
      Object.keys(AUTH_TOKEN_PURPOSES_REVOKED_ON_COMPLETION).toSorted(),
    ).toEqual(['email_change', 'password_change', 'password_reset']);
    expect(Object.isFrozen(AUTH_TOKEN_PURPOSES_REVOKED_ON_COMPLETION)).toBe(
      true,
    );
    for (const revoked of Object.values(
      AUTH_TOKEN_PURPOSES_REVOKED_ON_COMPLETION,
    )) {
      expect(Object.isFrozen(revoked)).toBe(true);
    }
  });
});
