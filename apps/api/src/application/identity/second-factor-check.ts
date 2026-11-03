import { hashPurpose } from '../../../lib/core/crypto/keyed-hasher.ts';
import type { SecondFactorInput } from '../../domain/auth/second-factor.ts';
import type { SecretBox, TotpAuthenticator } from '../auth/ports.ts';
import type { RecoveryCodeIssuer } from '../auth/recovery-code-issuer.ts';
import {
  checkSubjectSecondFactor,
  type SecondFactorScheme,
} from '../auth/second-factor-check.ts';
import type { RecoveryCodeStore, TotpCredentialStore } from './ports.ts';

export { isTotpEnabled } from '../auth/second-factor-check.ts';

// 保存を始めた用途の名前を変えると保存済みのハッシュ値と一致しなくなるため、名前は変えない
export const USER_RECOVERY_CODE_HASH_PURPOSE =
  hashPurpose('user-recovery-code');

// 秘密鍵は利用者のIDを文脈にして暗号化する
const USER_SECOND_FACTOR_SCHEME: SecondFactorScheme = Object.freeze({
  recoveryCodeHashPurpose: USER_RECOVERY_CODE_HASH_PURPOSE,
  secretContextOf: (userId: string): string => userId,
});

export interface SecondFactorCheckDependencies {
  readonly totpCredentials: TotpCredentialStore;
  readonly secretBox: SecretBox;
  readonly totp: TotpAuthenticator;
  readonly recoveryCodeIssuer: RecoveryCodeIssuer;
  readonly recoveryCodes: RecoveryCodeStore;
}

// 認証コードは一致した時間窓を使用済みにし、リカバリコードは消費する。どちらも一致しなければfalseを返す
export const checkSecondFactor = (
  dependencies: SecondFactorCheckDependencies,
  userId: string,
  input: SecondFactorInput,
  now: Date,
): Promise<boolean> =>
  checkSubjectSecondFactor(
    { ...dependencies, scheme: USER_SECOND_FACTOR_SCHEME },
    userId,
    input,
    now,
  );
