import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  createKeyedHasher,
  hashPurpose,
  type KeyedHasher,
} from '../../../lib/core/crypto/keyed-hasher.ts';
import { Pbkdf2PasswordHasher } from './pbkdf2-password-hasher.ts';

const PEPPER = ['pbkdf2', 'test', 'pepper'].join('-');

const OTHER_PEPPER = ['another', 'pbkdf2', 'pepper'].join('-');

const PASSWORD = ['correct', 'horse', 'battery', 'staple'].join(' ');

const FIXED_SALT = Uint8Array.from({ length: 16 }, (_, index) => index);

const STORED_PATTERN =
  /^pbkdf2-sha512\$100000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/;

// 照合1回の計測の回数と、利用者の要求1回で照合に使える時間の目安(WorkersのCPU時間の上限30秒に対し十分小さい値)
const TIMING_RUNS = 5;

const VERIFY_BUDGET_MS = 1_000;

function createHasher(pepper = PEPPER): Pbkdf2PasswordHasher {
  return new Pbkdf2PasswordHasher(createKeyedHasher(pepper));
}

function partsOf(stored: string): {
  readonly salt: Uint8Array;
  readonly derived: Uint8Array;
} {
  const [, , salt = '', derived = ''] = stored.split('$');
  return {
    salt: Uint8Array.fromBase64(salt, { alphabet: 'base64url' }),
    derived: Uint8Array.fromBase64(derived, { alphabet: 'base64url' }),
  };
}

// 実装とは別に、設計の手順(用途付きのHMACで前処理し、PBKDF2-HMAC-SHA512を10万回)で導出値を求める
async function expectedDerived(
  pepper: string,
  password: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  const pre = await createKeyedHasher(pepper).hash(
    hashPurpose('password-prehash'),
    password,
  );
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pre),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-512', salt, iterations: 100_000 },
      key,
      512,
    ),
  );
}

function replacePart(stored: string, index: number, value: string): string {
  return stored
    .split('$')
    .map((part, position) => (position === index ? value : part))
    .join('$');
}

describe('Pbkdf2PasswordHasher', () => {
  test('保存形式は方式・反復回数・16バイトのソルト・64バイトの導出値で、平文を含まない', async () => {
    const stored = await createHasher().hash(PASSWORD);

    expect(stored).toMatch(STORED_PATTERN);
    expect(partsOf(stored).salt).toHaveLength(16);
    expect(partsOf(stored).derived).toHaveLength(64);
    expect(stored).not.toContain(PASSWORD);
  });

  test('導出値はペッパーによるHMAC-SHA512の前処理の結果をPBKDF2-HMAC-SHA512で10万回処理した値である', async () => {
    const stored = await createHasher().hash(PASSWORD);
    const { salt, derived } = partsOf(stored);

    expect(derived).toEqual(await expectedDerived(PEPPER, PASSWORD, salt));
  });

  test('同じパスワードでも毎回別のソルトを使う', async () => {
    const hasher = createHasher();

    const first = await hasher.hash(PASSWORD);
    const second = await hasher.hash(PASSWORD);

    expect(partsOf(first).salt).not.toEqual(partsOf(second).salt);
    expect(first).not.toBe(second);
  });

  test('保存したハッシュと同じパスワードを照合すると真を返す', async () => {
    const hasher = createHasher();
    const stored = await hasher.hash(PASSWORD);

    await expect(hasher.verify(PASSWORD, stored)).resolves.toBe(true);
  });

  test('日本語や絵文字を含むパスワードも照合できる', async () => {
    const hasher = createHasher();
    const password = ['ぱすわーど', '🔑', 'テスト'].join('');
    const stored = await hasher.hash(password);

    await expect(hasher.verify(password, stored)).resolves.toBe(true);
    await expect(hasher.verify('ぱすわーど🔑', stored)).resolves.toBe(false);
  });

  test('異なるパスワードを照合すると偽を返す', async () => {
    const hasher = createHasher();
    const stored = await hasher.hash(PASSWORD);

    await expect(hasher.verify(`${PASSWORD}!`, stored)).resolves.toBe(false);
    await expect(hasher.verify('', stored)).resolves.toBe(false);
  });

  test('別のペッパーで作ったハッシュとは一致しない', async () => {
    const stored = await createHasher(OTHER_PEPPER).hash(PASSWORD);

    await expect(createHasher().verify(PASSWORD, stored)).resolves.toBe(false);
  });

  test('ペッパー無しでPBKDF2だけを掛けた値とは一致しない', async () => {
    const hasher = createHasher();
    const stored = await hasher.hash(PASSWORD);
    const { salt } = partsOf(stored);
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(PASSWORD),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const unpeppered = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-512', salt, iterations: 100_000 },
        key,
        512,
      ),
    ).toBase64({ alphabet: 'base64url', omitPadding: true });

    await expect(
      hasher.verify(PASSWORD, replacePart(stored, 3, unpeppered)),
    ).resolves.toBe(false);
  });

  describe('保存形式の違反は例外にせず偽を返す', () => {
    const encode = (bytes: Uint8Array): string =>
      bytes.toBase64({ alphabet: 'base64url', omitPadding: true });

    // ソルトを固定し、どの違反の例も毎回同じ保存形式から作る
    const hashWithFixedSalt = async (
      hasher: Pbkdf2PasswordHasher,
    ): Promise<string> => {
      vi.spyOn(crypto, 'getRandomValues').mockImplementation(
        <T extends ArrayBufferView | null>(array: T): T => {
          if (array instanceof Uint8Array) {
            array.set(FIXED_SALT.subarray(0, array.length));
          }
          return array;
        },
      );
      return hasher.hash(PASSWORD);
    };

    afterEach(() => {
      vi.restoreAllMocks();
    });

    test('前提: 固定のソルトから得る導出値のbase64urlは、標準のbase64と異なる文字(-か_)を含む', async () => {
      const stored = await hashWithFixedSalt(createHasher());

      expect(encode(partsOf(stored).salt)).toBe(encode(FIXED_SALT));
      expect(stored.split('$')[3]).toMatch(/[-_]/);
    });

    test.each<readonly [string, (stored: string) => string]>([
      ['空文字列', () => ''],
      ['区切りが足りない', (stored) => stored.split('$').slice(0, 3).join('$')],
      ['区切りが多い', (stored) => `${stored}$extra`],
      ['方式が違う', (stored) => replacePart(stored, 0, 'pbkdf2-sha256')],
      ['反復回数が違う', (stored) => replacePart(stored, 1, '99999')],
      [
        '反復回数に先頭の0がある',
        (stored) => replacePart(stored, 1, '0100000'),
      ],
      ['反復回数が数でない', (stored) => replacePart(stored, 1, 'many')],
      [
        'ソルトが15バイト',
        (stored) =>
          replacePart(stored, 2, encode(partsOf(stored).salt.slice(0, 15))),
      ],
      [
        'ソルトにパディングがある',
        (stored) => replacePart(stored, 2, `${encode(partsOf(stored).salt)}==`),
      ],
      [
        'ソルトがbase64urlでない',
        (stored) => replacePart(stored, 2, '!'.repeat(22)),
      ],
      [
        '導出値が63バイト',
        (stored) =>
          replacePart(stored, 3, encode(partsOf(stored).derived.slice(0, 63))),
      ],
      [
        '導出値が標準のbase64の表記',
        (stored) =>
          replacePart(
            stored,
            3,
            partsOf(stored).derived.toBase64({ omitPadding: true }),
          ),
      ],
      ['前後に空白がある', (stored) => ` ${stored} `],
    ])('%s', async (_label, corrupt) => {
      const hasher = createHasher();
      const stored = await hashWithFixedSalt(hasher);
      const corrupted = corrupt(stored);

      expect(corrupted).not.toBe(stored);
      await expect(hasher.verify(PASSWORD, stored)).resolves.toBe(true);
      await expect(hasher.verify(PASSWORD, corrupted)).resolves.toBe(false);
    });
  });

  test('ダミーの照合は、どのパスワードにも偽を返す', async () => {
    const hasher = createHasher();

    await expect(hasher.verifyAgainstDummy(PASSWORD)).resolves.toBe(false);
    await expect(hasher.verifyAgainstDummy('')).resolves.toBe(false);
  });

  test('ダミーの照合も、ペッパーによる前処理とPBKDF2の導出を照合と同じだけ行う', async () => {
    const keyed: KeyedHasher = createKeyedHasher(PEPPER);
    const hasher = new Pbkdf2PasswordHasher(keyed);
    const stored = await hasher.hash(PASSWORD);
    const prehash = vi.spyOn(keyed, 'hash');
    const deriveBits = vi.spyOn(crypto.subtle, 'deriveBits');
    const callsOf = async (
      run: () => Promise<boolean>,
    ): Promise<{ purposes: unknown[]; derivations: unknown[] }> => {
      prehash.mockClear();
      deriveBits.mockClear();
      await run();
      return {
        purposes: prehash.mock.calls.map(([purpose]) => purpose),
        // ソルトの値は照合ごとに違うため、長さだけを比べる
        derivations: deriveBits.mock.calls.map(([algorithm, , length]) => {
          const { salt, ...parameters } =
            algorithm as SubtleCryptoDeriveKeyAlgorithm;
          return [{ ...parameters, saltLength: salt?.byteLength }, length];
        }),
      };
    };

    const verifyCalls = await callsOf(() => hasher.verify(PASSWORD, stored));
    const dummyCalls = await callsOf(() => hasher.verifyAgainstDummy(PASSWORD));
    deriveBits.mockRestore();

    expect(verifyCalls.purposes).toEqual(['password-prehash']);
    expect(dummyCalls.purposes).toEqual(verifyCalls.purposes);
    expect(dummyCalls.derivations).toEqual([
      [
        {
          name: 'PBKDF2',
          hash: 'SHA-512',
          iterations: 100_000,
          saltLength: 16,
        },
        512,
      ],
    ]);
    expect(dummyCalls.derivations).toEqual(verifyCalls.derivations);
  });

  test(`照合${String(TIMING_RUNS)}回の所要時間を計測し、1回あたりの時間を記録する`, async ({
    annotate,
  }) => {
    const hasher = createHasher();
    const stored = await hasher.hash(PASSWORD);

    const verifyMs: number[] = [];
    const dummyMs: number[] = [];
    for (let run = 0; run < TIMING_RUNS; run += 1) {
      const verifyStartedAt = performance.now();
      await hasher.verify(PASSWORD, stored);
      verifyMs.push(performance.now() - verifyStartedAt);
      const dummyStartedAt = performance.now();
      await hasher.verifyAgainstDummy(PASSWORD);
      dummyMs.push(performance.now() - dummyStartedAt);
    }
    const describeRuns = (values: readonly number[]): string =>
      `平均${(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)}ms・最大${Math.max(...values).toFixed(1)}ms`;
    await annotate(
      `PBKDF2-HMAC-SHA512(10万回)の照合1回の所要時間: 照合 ${describeRuns(verifyMs)}、ダミーの照合 ${describeRuns(dummyMs)}`,
    );

    expect(Math.max(...verifyMs)).toBeGreaterThan(0);
    expect(Math.max(...verifyMs)).toBeLessThan(VERIFY_BUDGET_MS);
    expect(Math.max(...dummyMs)).toBeLessThan(VERIFY_BUDGET_MS);
  });
});
