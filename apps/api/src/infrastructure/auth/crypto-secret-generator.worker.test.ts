import { afterEach, describe, expect, test, vi } from 'vitest';

import { RECOVERY_CODE_ALPHABET } from '../../domain/auth/recovery-code-format.ts';
import { SESSION_TOKEN_PATTERN } from '../../application/session/session-verifier.ts';
import { CryptoSecretGenerator } from './crypto-secret-generator.ts';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const HANDLE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

// 乱数の供給元を、指定したバイト列を先頭から順に返すものに差し替える
function feedRandomBytes(bytes: readonly number[]): void {
  const queue = [...bytes];
  vi.spyOn(crypto, 'getRandomValues').mockImplementation(
    <T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint8Array) {
        for (let index = 0; index < array.length; index += 1) {
          const next = queue.shift();
          if (next === undefined) {
            throw new Error('用意した乱数のバイト列を使い切りました。');
          }
          array[index] = next;
        }
      }
      return array;
    },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CryptoSecretGenerator', () => {
  describe('token', () => {
    test('32バイトの乱数をパディング無しのbase64urlにした43文字で、セッションの識別子の形式に合う', () => {
      const token = new CryptoSecretGenerator().token();

      expect(token).toHaveLength(43);
      expect(token).toMatch(SESSION_TOKEN_PATTERN);
      expect(
        Uint8Array.fromBase64(token, { alphabet: 'base64url' }),
      ).toHaveLength(32);
    });

    test('暗号論的乱数のバイト列をそのまま符号化する', () => {
      const bytes = Array.from({ length: 32 }, (_, index) => index * 7);
      feedRandomBytes(bytes);

      expect(new CryptoSecretGenerator().token()).toBe(
        Uint8Array.from(bytes).toBase64({
          alphabet: 'base64url',
          omitPadding: true,
        }),
      );
    });

    test('呼び出すたびに別の値を返す', () => {
      const generator = new CryptoSecretGenerator();

      const tokens = new Set(
        Array.from({ length: 100 }, () => generator.token()),
      );

      expect(tokens.size).toBe(100);
    });
  });

  describe('randomString', () => {
    test('指定した長さで、指定した文字だけから成る', () => {
      const generator = new CryptoSecretGenerator();

      const handle = generator.randomString(12, HANDLE_ALPHABET);
      const code = generator.randomString(10, RECOVERY_CODE_ALPHABET);

      expect(handle).toMatch(/^[a-z0-9]{12}$/);
      expect(code).toMatch(new RegExp(`^[${RECOVERY_CODE_ALPHABET}]{10}$`));
    });

    test('文字の数で割り切れない範囲のバイトを捨てて引き直し、偏りを生まない', () => {
      // 3文字なら0〜254の255通りを3等分し、255は捨てる
      feedRandomBytes([255, 0, 255, 255, 254, 1, 128]);

      expect(new CryptoSecretGenerator().randomString(4, 'abc')).toBe('acbc');
    });

    test('文字の数が256の約数なら、どのバイトも捨てない', () => {
      feedRandomBytes([0, 255, 128, 3]);

      expect(new CryptoSecretGenerator().randomString(4, 'abcd')).toBe('adad');
    });

    test('多数の文字を選ぶと、各文字がほぼ同じ回数ずつ現れる', () => {
      const sampleSize = 31_000;
      const generated = new CryptoSecretGenerator().randomString(
        sampleSize,
        RECOVERY_CODE_ALPHABET,
      );
      const counts = new Map<string, number>();
      for (const character of generated) {
        counts.set(character, (counts.get(character) ?? 0) + 1);
      }

      const expected = sampleSize / RECOVERY_CODE_ALPHABET.length;
      expect(counts.size).toBe(RECOVERY_CODE_ALPHABET.length);
      for (const count of counts.values()) {
        // 期待値1000回・標準偏差約31回に対し、10標準偏差を超える偏りだけを誤りとする
        expect(Math.abs(count - expected)).toBeLessThan(320);
      }
    });

    test('サロゲートペアの文字もコードポイント単位で1文字として選ぶ', () => {
      feedRandomBytes([0, 1, 1]);

      expect(new CryptoSecretGenerator().randomString(3, '😀😎')).toBe(
        '😀😎😎',
      );
    });

    test('長さ0なら空文字列を返す', () => {
      expect(new CryptoSecretGenerator().randomString(0, 'abc')).toBe('');
    });

    test.each([
      ['長さが負', -1, 'abc'],
      ['長さが整数でない', 1.5, 'abc'],
      ['文字が空', 4, ''],
      ['文字に重複がある', 4, 'aab'],
      [
        '文字が257種類以上',
        4,
        Array.from({ length: 257 }, (_, index) =>
          String.fromCodePoint(0x4e00 + index),
        ).join(''),
      ],
    ])('%sなら例外を投げる', (_label, length, alphabet) => {
      expect(() =>
        new CryptoSecretGenerator().randomString(length, alphabet),
      ).toThrow(RangeError);
    });
  });

  describe('uuid', () => {
    test('UUIDの第4版の形式の値を毎回別に返す', () => {
      const generator = new CryptoSecretGenerator();

      const first = generator.uuid();
      const second = generator.uuid();

      expect(first).toMatch(UUID_V4_PATTERN);
      expect(second).toMatch(UUID_V4_PATTERN);
      expect(first).not.toBe(second);
    });
  });
});
