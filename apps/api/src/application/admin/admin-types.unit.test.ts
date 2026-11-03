import { describe, expect, test } from 'bun:test';

import { ADMIN_TYPES } from './admin-types.ts';

const EXPECTED_NAMES = [
  'AuditActionCatalog',
  'AuditLogStore',
  'AuditLogRecorder',
  'AuditLogReader',
  'AdminAccountStore',
  'AdminSessionStore',
  'AdminAuthTokenStore',
  'AdminLoginChallengeStore',
  'AdminTotpCredentialStore',
  'AdminRecoveryCodeStore',
  'AdminMailer',
  'AdminSettings',
  'AdminMailSendLimits',
] as const;

describe('ADMIN_TYPES', () => {
  test('管理者のストア・部品・ユースケースの識別子だけを持つ', () => {
    expect(Object.keys(ADMIN_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のadmin.<名前>である',
    (name) => {
      expect<symbol>(ADMIN_TYPES[name]).toBe(Symbol.for(`admin.${name}`));
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(ADMIN_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(ADMIN_TYPES)).toBe(true);
  });
});
