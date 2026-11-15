import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { PlatformEnv } from '../../../lib/workers/env/platform-env.ts';
import type { SecretBox } from '../../application/auth/ports.ts';

export type SecretBoxEnv = Pick<PlatformEnv, 'HASH_PEPPER'>;

export class SecretBoxOpenError extends Error {
  override readonly name = 'SecretBoxOpenError';
}

const VERSION = 'v1';

// 用途を区別する文字列。変えると保存済みの値を復元できなくなる
const KEY_INFO = 'totp-secret-v1';

const IV_BYTE_LENGTH = 12;

const TAG_BYTE_LENGTH = 16;

const BASE64URL_OPTIONS = {
  alphabet: 'base64url',
  omitPadding: true,
} as const;

const textEncoder = new TextEncoder();

const textDecoder = new TextDecoder();

async function deriveKey(pepper: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(pepper),
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(),
      info: textEncoder.encode(KEY_INFO),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function decodeCanonical(encoded: string): Uint8Array | undefined {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.fromBase64(encoded, { alphabet: 'base64url' });
  } catch {
    return undefined;
  }
  return bytes.toBase64(BASE64URL_OPTIONS) === encoded ? bytes : undefined;
}

function parseSealed(
  sealed: string,
): { readonly iv: Uint8Array; readonly ciphertext: Uint8Array } | undefined {
  const parts = sealed.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) {
    return undefined;
  }
  const iv = decodeCanonical(parts[1] ?? '');
  const ciphertext = decodeCanonical(parts[2] ?? '');
  if (
    iv?.length !== IV_BYTE_LENGTH ||
    ciphertext === undefined ||
    ciphertext.length < TAG_BYTE_LENGTH
  ) {
    return undefined;
  }
  return { iv, ciphertext };
}

@injectable()
export class HkdfAesGcmSecretBox implements SecretBox {
  private keyPromise: Promise<CryptoKey> | undefined;

  constructor(@inject(PLATFORM_TYPES.Env) private readonly env: SecretBoxEnv) {}

  async seal(plaintext: string, context: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: textEncoder.encode(context) },
      await this.key(),
      textEncoder.encode(plaintext),
    );
    return [
      VERSION,
      iv.toBase64(BASE64URL_OPTIONS),
      new Uint8Array(ciphertext).toBase64(BASE64URL_OPTIONS),
    ].join('.');
  }

  async open(sealed: string, context: string): Promise<string> {
    const parsed = parseSealed(sealed);
    if (parsed === undefined) {
      throw new SecretBoxOpenError('暗号化した値の形式が正しくありません。');
    }
    const key = await this.key();
    let plaintext: ArrayBuffer;
    try {
      plaintext = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: parsed.iv,
          additionalData: textEncoder.encode(context),
        },
        key,
        parsed.ciphertext,
      );
    } catch {
      throw new SecretBoxOpenError(
        '暗号化した値を復元できません。改ざんされたか、別の文脈で暗号化された値です。',
      );
    }
    return textDecoder.decode(plaintext);
  }

  private key(): Promise<CryptoKey> {
    // 失敗した導出を保持すると以後の呼び出しがすべて失敗するため、失敗したら次の呼び出しで導出し直す
    this.keyPromise ??= deriveKey(this.env.HASH_PEPPER).catch(
      (error: unknown) => {
        this.keyPromise = undefined;
        throw error;
      },
    );
    return this.keyPromise;
  }
}
