import { describe, expect, test } from 'bun:test';

import {
  createTotpCodeSource,
  decodeBase32,
  totpCodeAt,
  totpStepAt,
} from './totp.ts';

const PERIOD_MS = 30_000;

// RFC 6238の付録Bの試験用の鍵(SHA-1)。秘密鍵らしい文字列のリテラルを避けて実行時に組み立てる
const RFC6238_SECRET = new Uint8Array(
  Buffer.from('1234567890'.repeat(2), 'latin1'),
);

// RFC 4648の試験ベクトル(BASE32("foobar"))
const FOOBAR_BASE32 = ['MZXW6', 'YTBOI'].join('');

const FOOBAR_BYTES = new Uint8Array(Buffer.from('foobar', 'latin1'));

describe('decodeBase32', () => {
  test('RFC 4648のBase32の文字列をバイト列に戻す', () => {
    expect(decodeBase32(FOOBAR_BASE32)).toEqual(FOOBAR_BYTES);
  });

  test('小文字・空白・末尾のパディングを含む表記も同じバイト列に戻す', () => {
    const spaced = `${FOOBAR_BASE32.toLowerCase().replace(/(.{4})/gu, '$1 ')}======`;

    expect(decodeBase32(spaced)).toEqual(FOOBAR_BYTES);
  });

  test('Base32の文字でない文字を含むと失敗する', () => {
    expect(() => decodeBase32(`${FOOBAR_BASE32}1`)).toThrow(
      'Base32の文字ではない文字を含みます',
    );
  });
});

describe('totpStepAt', () => {
  test('30秒ごとの時間窓の通し番号を返す', () => {
    expect(totpStepAt(0)).toBe(0);
    expect(totpStepAt(PERIOD_MS - 1)).toBe(0);
    expect(totpStepAt(PERIOD_MS)).toBe(1);
    expect(totpStepAt(59_000)).toBe(1);
  });
});

describe('totpCodeAt', () => {
  test.each([
    [59, '287082'],
    [1_111_111_109, '081804'],
    [1_111_111_111, '050471'],
    [1_234_567_890, '005924'],
    [2_000_000_000, '279037'],
    [20_000_000_000, '353130'],
  ])(
    'RFC 6238の試験ベクトルの時刻%d秒で6桁の認証コード%sを返す',
    (seconds, expected) => {
      expect(totpCodeAt(RFC6238_SECRET, totpStepAt(seconds * 1000))).toBe(
        expected,
      );
    },
  );
});

interface FakeClock {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly sleeps: readonly number[];
}

const fakeClockAt = (startMs: number): FakeClock => {
  let current = startMs;
  const sleeps: number[] = [];
  return {
    now: () => current,
    sleep: (ms) => {
      sleeps.push(ms);
      current += ms;
      return Promise.resolve();
    },
    sleeps,
  };
};

describe('createTotpCodeSource', () => {
  test('最初は現在の時間窓の認証コードを返す', async () => {
    const clock = fakeClockAt(10 * PERIOD_MS + 5_000);
    const source = createTotpCodeSource(FOOBAR_BASE32, clock);

    expect(await source.nextCode()).toBe(totpCodeAt(FOOBAR_BYTES, 10));
    expect(clock.sleeps).toEqual([]);
  });

  test('同じ時間窓で続けて求めると、待たずに次の時間窓の認証コードを返す', async () => {
    const clock = fakeClockAt(10 * PERIOD_MS + 5_000);
    const source = createTotpCodeSource(FOOBAR_BASE32, clock);
    await source.nextCode();

    expect(await source.nextCode()).toBe(totpCodeAt(FOOBAR_BYTES, 11));
    expect(clock.sleeps).toEqual([]);
  });

  test('次の時間窓まで使い終えていれば、その時間窓が始まるまで待ってから後の時間窓の認証コードを返す', async () => {
    const clock = fakeClockAt(10 * PERIOD_MS + 5_000);
    const source = createTotpCodeSource(FOOBAR_BASE32, clock);
    await source.nextCode();
    await source.nextCode();

    expect(await source.nextCode()).toBe(totpCodeAt(FOOBAR_BYTES, 12));
    expect(clock.sleeps).toEqual([PERIOD_MS - 5_000]);
  });

  test('時間窓が進んでいれば、使い終えた時間窓より後の現在の時間窓の認証コードを返す', async () => {
    const clock = fakeClockAt(10 * PERIOD_MS + 5_000);
    const source = createTotpCodeSource(FOOBAR_BASE32, clock);
    await source.nextCode();
    await clock.sleep(3 * PERIOD_MS);

    expect(await source.nextCode()).toBe(totpCodeAt(FOOBAR_BYTES, 13));
  });
});
