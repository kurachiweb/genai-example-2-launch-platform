import { ADMIN_HASH_PURPOSES } from '../../domain/admin/admin-auth-token-purpose.ts';
import type { SecondFactorInput } from '../../domain/auth/second-factor.ts';
import type { SecretBox, TotpAuthenticator } from '../auth/ports.ts';
import type { RecoveryCodeIssuer } from '../auth/recovery-code-issuer.ts';
import {
  checkSubjectSecondFactor,
  type SecondFactorScheme,
} from '../auth/second-factor-check.ts';
import type {
  AdminRecoveryCodeStore,
  AdminTotpCredentialStore,
} from './ports.ts';

// 利用者の秘密鍵の文脈(利用者のID)と重ならないよう接頭辞を付ける。暗号化と復元で同じ値を使う
export const adminTotpSecretContext = (adminId: string): string =>
  `admin:${adminId}`;

const ADMIN_SECOND_FACTOR_SCHEME: SecondFactorScheme = Object.freeze({
  recoveryCodeHashPurpose: ADMIN_HASH_PURPOSES.recoveryCode,
  secretContextOf: adminTotpSecretContext,
});

export interface AdminSecondFactorCheckDependencies {
  readonly totpCredentials: AdminTotpCredentialStore;
  readonly secretBox: SecretBox;
  readonly totp: TotpAuthenticator;
  readonly recoveryCodeIssuer: RecoveryCodeIssuer;
  readonly recoveryCodes: AdminRecoveryCodeStore;
}

// 認証コードは現在の秘密鍵(保留ではない)で照合して時間窓を使用済みにし、リカバリコードは消費する。どちらも一致しなければfalseを返す
export const checkAdminSecondFactor = (
  dependencies: AdminSecondFactorCheckDependencies,
  adminId: string,
  input: SecondFactorInput,
  now: Date,
): Promise<boolean> =>
  checkSubjectSecondFactor(
    { ...dependencies, scheme: ADMIN_SECOND_FACTOR_SCHEME },
    adminId,
    input,
    now,
  );
