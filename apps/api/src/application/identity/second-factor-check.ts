import { hashPurpose } from '../../../lib/core/crypto/keyed-hasher.ts';
import {
  normalizeTotpCode,
  type SecondFactorInput,
} from '../../domain/auth/second-factor.ts';
import type { SecretBox, TotpAuthenticator } from '../auth/ports.ts';
import type { RecoveryCodeIssuer } from '../auth/recovery-code-issuer.ts';
import type {
  RecoveryCodeStore,
  TotpCredential,
  TotpCredentialStore,
} from './ports.ts';

// 保存を始めた用途の名前を変えると保存済みのハッシュ値と一致しなくなるため、名前は変えない
export const USER_RECOVERY_CODE_HASH_PURPOSE =
  hashPurpose('user-recovery-code');

export interface SecondFactorCheckDependencies {
  readonly totpCredentials: TotpCredentialStore;
  readonly secretBox: SecretBox;
  readonly totp: TotpAuthenticator;
  readonly recoveryCodeIssuer: RecoveryCodeIssuer;
  readonly recoveryCodes: RecoveryCodeStore;
}

// 設定の途中(保留)の秘密鍵は本人が認証アプリへ登録し終えた保証が無いため、有効化済みだけを第2要素として扱う
export const isTotpEnabled = (
  credential: TotpCredential | undefined,
): credential is TotpCredential & { readonly enabledAt: Date } =>
  credential !== undefined && credential.enabledAt !== null;

async function checkTotpCode(
  dependencies: SecondFactorCheckDependencies,
  userId: string,
  input: string,
  now: Date,
): Promise<boolean> {
  const code = normalizeTotpCode(input);
  if (code === undefined) {
    return false;
  }
  const credential = await dependencies.totpCredentials.find(userId);
  if (!isTotpEnabled(credential)) {
    return false;
  }
  const secret = await dependencies.secretBox.open(
    credential.sealedSecret,
    userId,
  );
  const verification = dependencies.totp.verify(secret, code, now);
  if (!verification.ok) {
    return false;
  }
  return dependencies.totpCredentials.advanceStep(userId, verification.step);
}

async function checkRecoveryCode(
  dependencies: SecondFactorCheckDependencies,
  userId: string,
  input: string,
): Promise<boolean> {
  const codeHash = await dependencies.recoveryCodeIssuer.hashInput(
    USER_RECOVERY_CODE_HASH_PURPOSE,
    input,
  );
  if (codeHash === undefined) {
    return false;
  }
  return dependencies.recoveryCodes.consume(userId, codeHash);
}

// 認証コードは一致した時間窓を使用済みにし、リカバリコードは消費する。どちらも一致しなければfalseを返す
export function checkSecondFactor(
  dependencies: SecondFactorCheckDependencies,
  userId: string,
  input: SecondFactorInput,
  now: Date,
): Promise<boolean> {
  return input.kind === 'totp'
    ? checkTotpCode(dependencies, userId, input.code, now)
    : checkRecoveryCode(dependencies, userId, input.code);
}
