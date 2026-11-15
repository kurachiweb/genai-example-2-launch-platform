import { inject, injectable } from 'inversify';

import type {
  HashPurpose,
  KeyedHasher,
} from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import {
  formatRecoveryCode,
  normalizeRecoveryCodeInput,
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_LENGTH,
} from '../../domain/auth/recovery-code-format.ts';
import { AUTH_TYPES } from './auth-types.ts';
import type { SecretGenerator } from './ports.ts';

export interface IssuedRecoveryCodes {
  // 表示用のハイフン区切りの平文。hashesと同じ順に並ぶ
  readonly plains: readonly string[];
  readonly hashes: readonly string[];
}

export interface RecoveryCodeIssuer {
  issue(purpose: HashPurpose): Promise<IssuedRecoveryCodes>;
  // 正規化できない入力はundefinedを返す
  hashInput(purpose: HashPurpose, input: string): Promise<string | undefined>;
}

@injectable()
export class HashingRecoveryCodeIssuer implements RecoveryCodeIssuer {
  constructor(
    @inject(AUTH_TYPES.SecretGenerator)
    private readonly generator: SecretGenerator,
    @inject(PLATFORM_TYPES.KeyedHasher)
    private readonly hasher: KeyedHasher,
  ) {}

  async issue(purpose: HashPurpose): Promise<IssuedRecoveryCodes> {
    const raws = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      this.generator.randomString(RECOVERY_CODE_LENGTH, RECOVERY_CODE_ALPHABET),
    );
    // 入力は区切りの無い形へ正規化して照合するため、ハッシュも区切りの無い形から作る
    const hashes = await Promise.all(
      raws.map((raw) => this.hasher.hash(purpose, raw)),
    );
    return { plains: raws.map(formatRecoveryCode), hashes };
  }

  async hashInput(
    purpose: HashPurpose,
    input: string,
  ): Promise<string | undefined> {
    const normalized = normalizeRecoveryCodeInput(input);
    return normalized === undefined
      ? undefined
      : this.hasher.hash(purpose, normalized);
  }
}
