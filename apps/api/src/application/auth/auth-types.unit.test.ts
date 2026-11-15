import { describe, expect, test } from 'bun:test';

import { AUTH_TYPES } from './auth-types.ts';

const EXPECTED_NAMES = [
  'PasswordHasher',
  'PwnedPasswordChecker',
  'PasswordPolicy',
  'SecretGenerator',
  'SecretIssuer',
  'SecretBox',
  'TotpAuthenticator',
  'RecoveryCodeIssuer',
  'LoginThrottle',
  'AuthIncidentReporter',
  'UserSessionVerifier',
  'AdminSessionVerifier',
] as const;

describe('AUTH_TYPES', () => {
  test('主体に依存しない認証部品の識別子だけを持つ', () => {
    expect(Object.keys(AUTH_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のauth.<名前>で、管理者側の束縛からも同じ値で参照できる',
    (name) => {
      expect<symbol>(AUTH_TYPES[name]).toBe(Symbol.for(`auth.${name}`));
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(AUTH_TYPES)).size).toBe(EXPECTED_NAMES.length);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(AUTH_TYPES)).toBe(true);
  });
});
