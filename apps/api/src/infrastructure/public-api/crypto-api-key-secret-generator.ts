import { inject, injectable } from 'inversify';

import type { KeyedHasher } from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  ApiKeySecretGenerator,
  GeneratedApiKeySecret,
} from '../../application/public-api/ports.ts';
import {
  API_KEY_HASH_PURPOSE,
  API_KEY_TOKEN_PREFIX,
} from '../../domain/public-api/api-key-token.ts';

const KEY_BYTE_LENGTH = 32;

@injectable()
export class CryptoApiKeySecretGenerator implements ApiKeySecretGenerator {
  constructor(
    @inject(PLATFORM_TYPES.KeyedHasher)
    private readonly hasher: KeyedHasher,
  ) {}

  async generate(): Promise<GeneratedApiKeySecret> {
    const body = crypto
      .getRandomValues(new Uint8Array(KEY_BYTE_LENGTH))
      .toBase64({ alphabet: 'base64url', omitPadding: true });
    const plain = `${API_KEY_TOKEN_PREFIX}${body}`;
    return { plain, hash: await this.hasher.hash(API_KEY_HASH_PURPOSE, plain) };
  }
}
