export type HashPurpose = string & { readonly __brand: 'HashPurpose' };

export interface KeyedHasher {
  hash(purpose: HashPurpose, value: string): Promise<string>;
  verify(
    purpose: HashPurpose,
    value: string,
    expectedHash: string,
  ): Promise<boolean>;
}

export class HasherConfigurationError extends Error {
  override readonly name = 'HasherConfigurationError';
}

const PURPOSE_SEPARATOR = '\u0000';
const HMAC_SHA512_BYTE_LENGTH = 64;
const BASE64URL_OPTIONS = {
  alphabet: 'base64url',
  omitPadding: true,
} as const;

const textEncoder = new TextEncoder();

export function hashPurpose(name: string): HashPurpose {
  if (name === '' || name.includes(PURPOSE_SEPARATOR)) {
    throw new RangeError('用途の名前は空にできず、NUL文字を含められません。');
  }
  return name as HashPurpose;
}

function importPepperKey(pepper: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    textEncoder.encode(pepper),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign', 'verify'],
  );
}

function encodeMessage(purpose: HashPurpose, value: string): Uint8Array {
  return textEncoder.encode(`${purpose}${PURPOSE_SEPARATOR}${value}`);
}

function decodeCanonicalHash(encoded: string): Uint8Array | undefined {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.fromBase64(encoded, { alphabet: 'base64url' });
  } catch {
    return undefined;
  }
  // デコードは空白・パディング・末尾の余りのビットを許すため、再エンコードして同じ表記のものだけを受け付ける
  if (
    bytes.length !== HMAC_SHA512_BYTE_LENGTH ||
    bytes.toBase64(BASE64URL_OPTIONS) !== encoded
  ) {
    return undefined;
  }
  return bytes;
}

export function createKeyedHasher(pepper: string | undefined): KeyedHasher {
  if (pepper === undefined || pepper === '') {
    throw new HasherConfigurationError(
      'ハッシュ化の鍵となるペッパーが設定されていません。',
    );
  }
  let keyPromise: Promise<CryptoKey> | undefined;
  const getKey = (): Promise<CryptoKey> => {
    keyPromise ??= importPepperKey(pepper);
    return keyPromise;
  };

  return {
    async hash(purpose, value) {
      const signature = await crypto.subtle.sign(
        'HMAC',
        await getKey(),
        encodeMessage(purpose, value),
      );
      return new Uint8Array(signature).toBase64(BASE64URL_OPTIONS);
    },
    async verify(purpose, value, expectedHash) {
      const expected = decodeCanonicalHash(expectedHash);
      if (expected === undefined) {
        return false;
      }
      return crypto.subtle.verify(
        'HMAC',
        await getKey(),
        expected,
        encodeMessage(purpose, value),
      );
    },
  };
}
