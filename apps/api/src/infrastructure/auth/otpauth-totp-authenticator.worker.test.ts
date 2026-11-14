import { Secret, TOTP, URI } from 'otpauth';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  OtpauthTotpAuthenticator,
  TotpSecretFormatError,
} from './otpauth-totp-authenticator.ts';

// RFC 6238の付録Bの試験用の秘密鍵(SHA-1)
const RFC6238_SECRET = Secret.fromLatin1('12345678901234567890').base32;

const RFC6238_TIMESTAMP_MS = 1_111_111_109_000;

const RFC6238_STEP = Math.floor(RFC6238_TIMESTAMP_MS / 30_000);

const ISSUER = 'Example Service';

const HANDLE_LABEL = '@taro_yamada';

const BASE32_PATTERN = /^[A-Z2-7]+$/;

function codeAt(timestampMs: number): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(RFC6238_SECRET),
  }).generate({ timestamp: timestampMs });
}

// 乱数の供給元を、指定したバイト列を返すものに差し替える
function feedRandomBytes(bytes: readonly number[]): void {
  vi.spyOn(crypto, 'getRandomValues').mockImplementation(
    <T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint8Array) {
        array.set(bytes.slice(0, array.length));
      }
      return array;
    },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OtpauthTotpAuthenticator(秘密鍵の生成)', () => {
  test('暗号論的乱数の20バイトをbase32にした秘密鍵を返す', () => {
    const bytes = Array.from({ length: 20 }, (_, index) => index * 13);
    feedRandomBytes(bytes);

    const secret = new OtpauthTotpAuthenticator().generateSecret();

    expect(secret).toBe(
      new Secret({ buffer: Uint8Array.from(bytes).buffer }).base32,
    );
    expect(secret).toHaveLength(32);
    expect(secret).toMatch(BASE32_PATTERN);
    expect(Secret.fromBase32(secret).bytes).toHaveLength(20);
  });

  test('呼び出すたびに別の秘密鍵を返す', () => {
    const authenticator = new OtpauthTotpAuthenticator();

    const secrets = new Set(
      Array.from({ length: 100 }, () => authenticator.generateSecret()),
    );

    expect(secrets.size).toBe(100);
  });
});

describe('OtpauthTotpAuthenticator(URI)', () => {
  test('発行者名とハンドルのラベル、SHA-1・6桁・30秒のotpauth://のURIを組み立てる', () => {
    const uri = new OtpauthTotpAuthenticator().buildUri(
      RFC6238_SECRET,
      ISSUER,
      HANDLE_LABEL,
    );

    expect(uri).toBe(
      `otpauth://totp/Example%20Service:%40taro_yamada?issuer=Example%20Service&secret=${RFC6238_SECRET}&algorithm=SHA1&digits=6&period=30`,
    );
    expect(URI.parse(uri)).toMatchObject({
      issuer: ISSUER,
      label: HANDLE_LABEL,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
  });

  test('URIから読み取った設定で生成したコードを、同じ秘密鍵で照合できる', () => {
    const authenticator = new OtpauthTotpAuthenticator();
    const secret = authenticator.generateSecret();
    const uri = authenticator.buildUri(secret, ISSUER, HANDLE_LABEL);
    const now = new Date(RFC6238_TIMESTAMP_MS);

    const code = URI.parse(uri).generate({ timestamp: now.getTime() });

    expect(authenticator.verify(secret, code, now)).toStrictEqual({
      ok: true,
      step: RFC6238_STEP,
    });
  });

  test.each(['taro@mail.example', '@taro@mail.example', 'taro.yamada@mail'])(
    'メールアドレスを含み得るラベル%sを拒否する',
    (label) => {
      const authenticator = new OtpauthTotpAuthenticator();

      expect(() =>
        authenticator.buildUri(RFC6238_SECRET, ISSUER, label),
      ).toThrow(RangeError);
    },
  );

  test('形式の正しくない秘密鍵では、秘密鍵の値を含まない例外を投げる', () => {
    const malformed = `${RFC6238_SECRET.slice(0, 10)}1`;

    let caught: unknown;
    try {
      new OtpauthTotpAuthenticator().buildUri(malformed, ISSUER, HANDLE_LABEL);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TotpSecretFormatError);
    expect(String(caught)).not.toContain(malformed);
    expect((caught as Error).cause).toBeUndefined();
  });
});

describe('OtpauthTotpAuthenticator(照合)', () => {
  test('RFC 6238の試験値のコードを受け入れ、一致した時間窓の番号を返す', () => {
    const authenticator = new OtpauthTotpAuthenticator();

    expect(
      authenticator.verify(RFC6238_SECRET, '287082', new Date(59_000)),
    ).toStrictEqual({ ok: true, step: 1 });
    expect(
      authenticator.verify(
        RFC6238_SECRET,
        '081804',
        new Date(RFC6238_TIMESTAMP_MS),
      ),
    ).toStrictEqual({ ok: true, step: RFC6238_STEP });
  });

  test.each([
    { offset: -1, label: '1つ前' },
    { offset: 1, label: '1つ後' },
  ])(
    '$labelの時間窓のコードを受け入れ、その時間窓の番号を返す',
    ({ offset }) => {
      const code = codeAt(RFC6238_TIMESTAMP_MS + offset * 30_000);

      const result = new OtpauthTotpAuthenticator().verify(
        RFC6238_SECRET,
        code,
        new Date(RFC6238_TIMESTAMP_MS),
      );

      expect(result).toStrictEqual({ ok: true, step: RFC6238_STEP + offset });
    },
  );

  test.each([-2, 2])('%iつ離れた時間窓のコードを拒否する', (offset) => {
    const code = codeAt(RFC6238_TIMESTAMP_MS + offset * 30_000);

    const result = new OtpauthTotpAuthenticator().verify(
      RFC6238_SECRET,
      code,
      new Date(RFC6238_TIMESTAMP_MS),
    );

    expect(result).toStrictEqual({ ok: false });
  });

  test('前後の時間窓のどれとも一致しないコードを拒否する', () => {
    const now = new Date(RFC6238_TIMESTAMP_MS);
    const validCodes = new Set(
      [-1, 0, 1].map((offset) =>
        codeAt(RFC6238_TIMESTAMP_MS + offset * 30_000),
      ),
    );
    const wrongCode = ['000000', '111111', '222222'].find(
      (code) => !validCodes.has(code),
    );

    const result = new OtpauthTotpAuthenticator().verify(
      RFC6238_SECRET,
      wrongCode ?? '',
      now,
    );

    expect(result).toStrictEqual({ ok: false });
  });

  test.each(['', '28708', '2870820', '28708a', ' 287082', '２８７０８２'])(
    '6桁の半角数字でないコード「%s」を拒否する',
    (code) => {
      const result = new OtpauthTotpAuthenticator().verify(
        RFC6238_SECRET,
        code,
        new Date(59_000),
      );

      expect(result).toStrictEqual({ ok: false });
    },
  );

  test('別の秘密鍵のコードを拒否する', () => {
    const otherSecret = Secret.fromLatin1('abcdefghijabcdefghij').base32;
    const code = codeAt(RFC6238_TIMESTAMP_MS);

    const result = new OtpauthTotpAuthenticator().verify(
      otherSecret,
      code,
      new Date(RFC6238_TIMESTAMP_MS),
    );

    expect(result).toStrictEqual({ ok: false });
  });

  test.each(['', 'not-base32!'])(
    '形式の正しくない秘密鍵「%s」では例外を投げる',
    (secret) => {
      expect(() =>
        new OtpauthTotpAuthenticator().verify(
          secret,
          '287082',
          new Date(59_000),
        ),
      ).toThrow(TotpSecretFormatError);
    },
  );
});
