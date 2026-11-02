import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  HkdfAesGcmSecretBox,
  SecretBoxOpenError,
} from './hkdf-aes-gcm-secret-box.ts';

const PEPPER = ['secret', 'box', 'test', 'pepper'].join('-');

const OTHER_PEPPER = ['another', 'secret', 'box', 'pepper'].join('-');

// TOTPの秘密鍵と同じ形(Base32の32文字)の値を、秘密鍵らしい文字列リテラルを書かずに作る
const PLAINTEXT = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  .split('')
  .reverse()
  .join('');

const USER_ID = '01JBQ8Z9X7K3M5N7P9R1T3V5X7';

const OTHER_USER_ID = '01JBQ8Z9X7K3M5N7P9R1T3V5X8';

const SEALED_PATTERN = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/;

const textEncoder = new TextEncoder();

function createBox(pepper = PEPPER): HkdfAesGcmSecretBox {
  return new HkdfAesGcmSecretBox({ HASH_PEPPER: pepper });
}

function decode(part: string): Uint8Array {
  return Uint8Array.fromBase64(part, { alphabet: 'base64url' });
}

function encode(bytes: Uint8Array): string {
  return bytes.toBase64({ alphabet: 'base64url', omitPadding: true });
}

function partsOf(sealed: string): {
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
} {
  const [, iv = '', ciphertext = ''] = sealed.split('.');
  return { iv: decode(iv), ciphertext: decode(ciphertext) };
}

// 実装とは別に、設計の手順(ペッパーからHKDF-SHA-256で導出したAES-256-GCMの鍵、利用者のIDを追加認証データ)で復号する
async function decryptIndependently(
  pepper: string,
  sealed: string,
  context: string,
): Promise<string> {
  const material = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(pepper),
    'HKDF',
    false,
    ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(),
      info: textEncoder.encode('totp-secret-v1'),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const { iv, ciphertext } = partsOf(sealed);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: textEncoder.encode(context) },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(plaintext);
}

function replacePart(sealed: string, index: number, value: string): string {
  return sealed
    .split('.')
    .map((part, position) => (position === index ? value : part))
    .join('.');
}

function flipFirstBit(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(bytes, (byte, index) =>
    index === 0 ? byte ^ 1 : byte,
  );
}

describe('HkdfAesGcmSecretBox', () => {
  test('暗号化した値は版・12バイトのIV・暗号文の形式で、平文を含まない', async () => {
    const sealed = await createBox().seal(PLAINTEXT, USER_ID);

    expect(sealed).toMatch(SEALED_PATTERN);
    expect(partsOf(sealed).iv).toHaveLength(12);
    // AES-GCMの暗号文は平文と同じ長さに16バイトの認証タグが付く
    expect(partsOf(sealed).ciphertext).toHaveLength(PLAINTEXT.length + 16);
    expect(sealed).not.toContain(PLAINTEXT);
    expect(sealed).not.toContain(USER_ID);
  });

  test('暗号化した値を同じ利用者のIDで復元できる', async () => {
    const box = createBox();
    const sealed = await box.seal(PLAINTEXT, USER_ID);

    await expect(box.open(sealed, USER_ID)).resolves.toBe(PLAINTEXT);
  });

  test('鍵はペッパーからHKDF-SHA-256で導出したAES-256-GCMの鍵で、利用者のIDを追加認証データにする', async () => {
    const sealed = await createBox().seal(PLAINTEXT, USER_ID);

    await expect(decryptIndependently(PEPPER, sealed, USER_ID)).resolves.toBe(
      PLAINTEXT,
    );
  });

  test('同じ平文でも毎回別のIVで暗号化する', async () => {
    const box = createBox();

    const first = await box.seal(PLAINTEXT, USER_ID);
    const second = await box.seal(PLAINTEXT, USER_ID);

    expect(partsOf(first).iv).not.toEqual(partsOf(second).iv);
    expect(first).not.toBe(second);
  });

  test('日本語を含む平文も復元できる', async () => {
    const box = createBox();
    const sealed = await box.seal('秘密の値', USER_ID);

    await expect(box.open(sealed, USER_ID)).resolves.toBe('秘密の値');
  });

  test('別の利用者のIDでは復元できず例外を投げる', async () => {
    const box = createBox();
    const sealed = await box.seal(PLAINTEXT, USER_ID);

    await expect(box.open(sealed, OTHER_USER_ID)).rejects.toBeInstanceOf(
      SecretBoxOpenError,
    );
  });

  test('別のペッパーでは復元できず例外を投げる(データベースの内容だけでは復元できない)', async () => {
    const sealed = await createBox(OTHER_PEPPER).seal(PLAINTEXT, USER_ID);

    await expect(createBox().open(sealed, USER_ID)).rejects.toBeInstanceOf(
      SecretBoxOpenError,
    );
  });

  describe('改ざん・形式の違反を検出して例外を投げる', () => {
    test.each<readonly [string, (sealed: string) => string]>([
      [
        '暗号文の1ビットを変えた',
        (sealed) =>
          replacePart(
            sealed,
            2,
            encode(flipFirstBit(partsOf(sealed).ciphertext)),
          ),
      ],
      [
        'IVの1ビットを変えた',
        (sealed) =>
          replacePart(sealed, 1, encode(flipFirstBit(partsOf(sealed).iv))),
      ],
      [
        '認証タグを切り詰めた',
        (sealed) =>
          replacePart(
            sealed,
            2,
            encode(partsOf(sealed).ciphertext.slice(0, -1)),
          ),
      ],
      ['版が違う', (sealed) => replacePart(sealed, 0, 'v2')],
      ['区切りが足りない', (sealed) => sealed.split('.').slice(0, 2).join('.')],
      ['区切りが多い', (sealed) => `${sealed}.extra`],
      [
        'IVが11バイト',
        (sealed) =>
          replacePart(sealed, 1, encode(partsOf(sealed).iv.slice(0, 11))),
      ],
      [
        'IVがbase64urlでない',
        (sealed) => replacePart(sealed, 1, '!'.repeat(16)),
      ],
      ['暗号文にパディングがある', (sealed) => `${sealed}==`],
      ['暗号文が空', (sealed) => replacePart(sealed, 2, '')],
      ['空文字列', () => ''],
    ])('%s', async (_label, corrupt) => {
      const box = createBox();
      const sealed = await box.seal(PLAINTEXT, USER_ID);

      await expect(box.open(corrupt(sealed), USER_ID)).rejects.toBeInstanceOf(
        SecretBoxOpenError,
      );
    });
  });

  test('復元できないときの例外のメッセージに平文・利用者のID・暗号化した値を含めない', async () => {
    const box = createBox();
    const sealed = await box.seal(PLAINTEXT, USER_ID);

    const error: unknown = await box
      .open(sealed, OTHER_USER_ID)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SecretBoxOpenError);
    const message = (error as Error).message;
    expect(message).not.toContain(PLAINTEXT);
    expect(message).not.toContain(OTHER_USER_ID);
    expect(message).not.toContain(sealed);
  });

  describe('鍵の導出の失敗', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    test('鍵の導出の失敗は復元の失敗に変えず、そのまま投げる', async () => {
      const sealed = await createBox().seal(PLAINTEXT, USER_ID);
      const failure = new Error('鍵の導出に失敗しました。');
      vi.spyOn(crypto.subtle, 'deriveKey').mockRejectedValueOnce(failure);

      await expect(createBox().open(sealed, USER_ID)).rejects.toBe(failure);
    });

    test('鍵の導出に失敗した後の呼び出しは、鍵を導出し直して復元できる', async () => {
      const sealed = await createBox().seal(PLAINTEXT, USER_ID);
      const box = createBox();
      vi.spyOn(crypto.subtle, 'deriveKey').mockRejectedValueOnce(
        new Error('鍵の導出に失敗しました。'),
      );
      await expect(box.open(sealed, USER_ID)).rejects.toThrow();

      await expect(box.open(sealed, USER_ID)).resolves.toBe(PLAINTEXT);
    });
  });
});
