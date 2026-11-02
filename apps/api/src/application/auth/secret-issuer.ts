import { inject, injectable } from 'inversify';

import type {
  HashPurpose,
  KeyedHasher,
} from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AUTH_TYPES } from './auth-types.ts';
import type { SecretGenerator } from './ports.ts';

export interface IssuedSecret {
  // 平文はメールのリンクと応答にだけ使い、保存するのはハッシュだけにする
  readonly plain: string;
  readonly hash: string;
}

export interface SecretIssuer {
  issue(purpose: HashPurpose): Promise<IssuedSecret>;
  hashOf(purpose: HashPurpose, plain: string): Promise<string>;
}

@injectable()
export class HashingSecretIssuer implements SecretIssuer {
  constructor(
    @inject(AUTH_TYPES.SecretGenerator)
    private readonly generator: SecretGenerator,
    @inject(PLATFORM_TYPES.KeyedHasher)
    private readonly hasher: KeyedHasher,
  ) {}

  async issue(purpose: HashPurpose): Promise<IssuedSecret> {
    const plain = this.generator.token();
    return { plain, hash: await this.hasher.hash(purpose, plain) };
  }

  hashOf(purpose: HashPurpose, plain: string): Promise<string> {
    return this.hasher.hash(purpose, plain);
  }
}
