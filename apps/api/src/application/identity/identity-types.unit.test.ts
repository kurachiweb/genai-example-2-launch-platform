import { describe, expect, test } from 'bun:test';

import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import { IDENTITY_TYPES } from './identity-types.ts';

const EXPECTED_NAMES = [
  'UserAccountStore',
  'UserSessionStore',
  'AuthTokenStore',
  'LoginChallengeStore',
  'TotpCredentialStore',
  'RecoveryCodeStore',
  'UserLifecycleCommitter',
  'UserLifecycleStore',
  'HandleAvailability',
  'DisposableEmailChecker',
  'DeviceDescriber',
  'IdentityMailer',
  'IdentitySettings',
  'SessionIssuer',
  'AccountGuard',
  'MailSendLimits',
  'Registration',
  'EmailVerification',
  'DisposableEmailCheck',
  'Login',
  'ReAuthenticator',
  'SessionManagement',
  'PasswordReset',
  'EmailChange',
  'PasswordChange',
  'TotpManagement',
  'Withdrawal',
  'AdministrativeWithdrawal',
  'UserSuspension',
  'AccountUploaderEligibility',
  'PurgeOrchestratorJob',
  'LifecycleRedispatchJob',
  'CredentialCleanupJob',
  'DisposableRecheckSweepJob',
] as const;

describe('IDENTITY_TYPES', () => {
  test('利用者のストア・部品・ユースケース・ジョブの識別子だけを持つ', () => {
    expect(Object.keys(IDENTITY_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のidentity.<名前>である',
    (name) => {
      expect<symbol>(IDENTITY_TYPES[name]).toBe(Symbol.for(`identity.${name}`));
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(IDENTITY_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('両アプリが共有する識別子と重ならない', () => {
    const shared = new Set<symbol>(Object.values(IDENTITY_PLATFORM_TYPES));

    for (const identifier of Object.values(IDENTITY_TYPES)) {
      expect(shared.has(identifier)).toBe(false);
    }
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(IDENTITY_TYPES)).toBe(true);
  });
});
