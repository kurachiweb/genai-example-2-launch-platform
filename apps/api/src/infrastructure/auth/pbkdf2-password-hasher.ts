import { inject, injectable } from 'inversify';

import {
  hashPurpose,
  type KeyedHasher,
} from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { PasswordHasher } from '../../application/auth/ports.ts';

const SCHEME = 'pbkdf2-sha512';

// workerdはPBKDF2の反復回数が10万回を超えると例外にするため、上限ちょうどを使う
const ITERATIONS = 100_000;

const SALT_BYTE_LENGTH = 16;

const DERIVED_BYTE_LENGTH = 64;

const PREHASH_PURPOSE = hashPurpose('password-prehash');

const BASE64URL_OPTIONS = {
  alphabet: 'base64url',
  omitPadding: true,
} as const;

// 利用者がいないときの照合に使う値。照合の結果は使わず、計算量を揃えるためだけに使う
const DUMMY_SALT = new Uint8Array(SALT_BYTE_LENGTH);

const DUMMY_DERIVED = new Uint8Array(DERIVED_BYTE_LENGTH);

const textEncoder = new TextEncoder();

interface StoredPassword {
  readonly salt: Uint8Array;
  readonly derived: Uint8Array;
}

function decodeCanonical(
  encoded: string,
  byteLength: number,
): Uint8Array | undefined {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.fromBase64(encoded, { alphabet: 'base64url' });
  } catch {
    return undefined;
  }
  // デコードは空白・パディング・末尾の余りのビットを許すため、再エンコードして同じ表記のものだけを受け付ける
  if (
    bytes.length !== byteLength ||
    bytes.toBase64(BASE64URL_OPTIONS) !== encoded
  ) {
    return undefined;
  }
  return bytes;
}

function parseStored(stored: string): StoredPassword | undefined {
  const parts = stored.split('$');
  if (parts.length !== 4) {
    return undefined;
  }
  const [scheme, iterations, encodedSalt = '', encodedDerived = ''] = parts;
  if (scheme !== SCHEME || iterations !== String(ITERATIONS)) {
    return undefined;
  }
  const salt = decodeCanonical(encodedSalt, SALT_BYTE_LENGTH);
  const derived = decodeCanonical(encodedDerived, DERIVED_BYTE_LENGTH);
  if (salt === undefined || derived === undefined) {
    return undefined;
  }
  return { salt, derived };
}

@injectable()
export class Pbkdf2PasswordHasher implements PasswordHasher {
  constructor(
    @inject(PLATFORM_TYPES.KeyedHasher)
    private readonly hasher: KeyedHasher,
  ) {}

  async hash(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTE_LENGTH));
    const derived = await this.derive(password, salt);
    return [
      SCHEME,
      String(ITERATIONS),
      salt.toBase64(BASE64URL_OPTIONS),
      derived.toBase64(BASE64URL_OPTIONS),
    ].join('$');
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const parsed = parseStored(stored);
    if (parsed === undefined) {
      return false;
    }
    const derived = await this.derive(password, parsed.salt);
    return crypto.subtle.timingSafeEqual(derived, parsed.derived);
  }

  async verifyAgainstDummy(password: string): Promise<false> {
    const derived = await this.derive(password, DUMMY_SALT);
    crypto.subtle.timingSafeEqual(derived, DUMMY_DERIVED);
    return false;
  }

  // ペッパーによるHMACで前処理し、パスワードの長さによらずPBKDF2の入力を86文字に揃える
  private async derive(
    password: string,
    salt: Uint8Array,
  ): Promise<Uint8Array> {
    const prehashed = await this.hasher.hash(PREHASH_PURPOSE, password);
    const key = await crypto.subtle.importKey(
      'raw',
      textEncoder.encode(prehashed),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-512', salt, iterations: ITERATIONS },
      key,
      DERIVED_BYTE_LENGTH * 8,
    );
    return new Uint8Array(bits);
  }
}
