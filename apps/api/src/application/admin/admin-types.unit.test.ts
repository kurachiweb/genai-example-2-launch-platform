import { describe, expect, test } from 'bun:test';

import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import { ADMIN_TYPES } from './admin-types.ts';

const EXPECTED_NAMES = [
  'AuditActionCatalog',
  'AuditLogStore',
  'AuditLogRecorder',
  'AuditLogReader',
  'AdminAccountStore',
  'AdminSessionStore',
  'AdminSessionIssuer',
  'AdminSessionVerifier',
  'AdminAuthTokenStore',
  'AdminLoginChallengeStore',
  'AdminTotpCredentialStore',
  'AdminRecoveryCodeStore',
  'AdminMailer',
  'AdminSettings',
  'AdminMailSendLimits',
  'AdminAuthorizer',
  'AdminLogin',
  'AdminReAuthenticator',
  'AdminInvitation',
  'AdminPasswordReset',
  'AdminEmailChange',
  'AdminPasswordChange',
  'AdminTotpManagement',
  'AdminAccountManagement',
  'AdminProfile',
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

  // 両アプリ共通の照会口の識別子も同じadmin.の接頭辞を使うため、名前が重なると別々の束縛が同じシンボルに入る
  test('両アプリ共通の照会口の識別子とメンバーの名前もシンボルも重ならない', () => {
    const platformNames = new Set(Object.keys(ADMIN_PLATFORM_TYPES));
    const platformSymbols = new Set<symbol>(
      Object.values(ADMIN_PLATFORM_TYPES),
    );

    expect(
      Object.keys(ADMIN_TYPES).filter((name) => platformNames.has(name)),
    ).toEqual([]);
    expect(
      Object.values(ADMIN_TYPES).filter((symbol) =>
        platformSymbols.has(symbol),
      ),
    ).toEqual([]);
  });
});
