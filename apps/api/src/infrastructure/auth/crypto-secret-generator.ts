import { injectable } from 'inversify';

import type { SecretGenerator } from '../../application/auth/ports.ts';

const TOKEN_BYTE_LENGTH = 32;

const BYTE_VALUES = 256;

function charactersOf(alphabet: string): readonly string[] {
  const characters = Array.from(alphabet);
  if (characters.length === 0 || characters.length > BYTE_VALUES) {
    throw new RangeError('文字の集合は1〜256文字にしてください。');
  }
  if (new Set(characters).size !== characters.length) {
    throw new RangeError('文字の集合に同じ文字を重ねないでください。');
  }
  return characters;
}

@injectable()
export class CryptoSecretGenerator implements SecretGenerator {
  token(): string {
    return crypto
      .getRandomValues(new Uint8Array(TOKEN_BYTE_LENGTH))
      .toBase64({ alphabet: 'base64url', omitPadding: true });
  }

  randomString(length: number, alphabet: string): string {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new RangeError('長さは0以上の整数にしてください。');
    }
    const characters = charactersOf(alphabet);
    // 文字の数の倍数に収まらない端のバイトを捨てる(棄却法)ことで、剰余による偏りを無くす
    const acceptedBelow = BYTE_VALUES - (BYTE_VALUES % characters.length);
    let result = '';
    let remaining = length;
    while (remaining > 0) {
      for (const byte of crypto.getRandomValues(new Uint8Array(remaining))) {
        if (byte < acceptedBelow) {
          result += characters[byte % characters.length] ?? '';
          remaining -= 1;
        }
      }
    }
    return result;
  }

  uuid(): string {
    return crypto.randomUUID();
  }
}
