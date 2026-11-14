import type { HashPurpose } from '../../../lib/core/crypto/keyed-hasher.ts';
import {
  normalizeTotpCode,
  type SecondFactorInput,
} from '../../domain/auth/second-factor.ts';
import type { SecretBox, TotpAuthenticator } from './ports.ts';
import type { RecoveryCodeIssuer } from './recovery-code-issuer.ts';

export interface SecondFactorCredential {
  readonly sealedSecret: string | null;
  readonly enabledAt: Date | null;
}

export interface SecondFactorCredentialStore {
  find(subjectId: string): Promise<SecondFactorCredential | undefined>;
  // 使用済みの時間窓より新しいときだけ更新し、同じ時間窓の認証コードの再使用を拒否する
  advanceStep(subjectId: string, step: number): Promise<boolean>;
}

export interface SecondFactorRecoveryCodeStore {
  // 一致すれば削除する
  consume(subjectId: string, codeHash: string): Promise<boolean>;
}

// 主体の種類ごとに異なる、リカバリコードのハッシュの用途と秘密鍵の暗号化の文脈
export interface SecondFactorScheme {
  readonly recoveryCodeHashPurpose: HashPurpose;
  readonly secretContextOf: (subjectId: string) => string;
}

export interface SubjectSecondFactorCheckDependencies {
  readonly scheme: SecondFactorScheme;
  readonly totpCredentials: SecondFactorCredentialStore;
  readonly secretBox: SecretBox;
  readonly totp: TotpAuthenticator;
  readonly recoveryCodeIssuer: RecoveryCodeIssuer;
  readonly recoveryCodes: SecondFactorRecoveryCodeStore;
}

// 設定の途中(保留)の秘密鍵は本人が認証アプリへ登録し終えた保証が無いため、有効化済みだけを第2要素として扱う
export const isTotpEnabled = <T extends SecondFactorCredential>(
  credential: T | undefined,
): credential is T & {
  readonly sealedSecret: string;
  readonly enabledAt: Date;
} =>
  credential !== undefined &&
  credential.sealedSecret !== null &&
  credential.enabledAt !== null;

async function checkTotpCode(
  dependencies: SubjectSecondFactorCheckDependencies,
  subjectId: string,
  input: string,
  now: Date,
): Promise<boolean> {
  const code = normalizeTotpCode(input);
  if (code === undefined) {
    return false;
  }
  const credential = await dependencies.totpCredentials.find(subjectId);
  if (!isTotpEnabled(credential)) {
    return false;
  }
  const secret = await dependencies.secretBox.open(
    credential.sealedSecret,
    dependencies.scheme.secretContextOf(subjectId),
  );
  const verification = dependencies.totp.verify(secret, code, now);
  if (!verification.ok) {
    return false;
  }
  return dependencies.totpCredentials.advanceStep(subjectId, verification.step);
}

async function checkRecoveryCode(
  dependencies: SubjectSecondFactorCheckDependencies,
  subjectId: string,
  input: string,
): Promise<boolean> {
  const codeHash = await dependencies.recoveryCodeIssuer.hashInput(
    dependencies.scheme.recoveryCodeHashPurpose,
    input,
  );
  if (codeHash === undefined) {
    return false;
  }
  return dependencies.recoveryCodes.consume(subjectId, codeHash);
}

// 認証コードは一致した時間窓を使用済みにし、リカバリコードは消費する。どちらも一致しなければfalseを返す
export function checkSubjectSecondFactor(
  dependencies: SubjectSecondFactorCheckDependencies,
  subjectId: string,
  input: SecondFactorInput,
  now: Date,
): Promise<boolean> {
  return input.kind === 'totp'
    ? checkTotpCode(dependencies, subjectId, input.code, now)
    : checkRecoveryCode(dependencies, subjectId, input.code);
}
