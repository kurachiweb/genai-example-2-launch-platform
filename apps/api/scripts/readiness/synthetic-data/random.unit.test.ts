import { describe, expect, test } from 'bun:test';

import {
  deterministicInteger,
  deterministicUlid,
  deterministicUuid,
} from './random.ts';

const AT = new Date('2026-11-24T08:00:00.000Z');

describe('deterministicUlid', () => {
  test('ULIDの形式で、先頭10文字が時刻を表す', () => {
    const id = deterministicUlid(AT, 'user:1');

    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/u);
    expect(id.slice(0, 10)).toBe(deterministicUlid(AT, 'user:2').slice(0, 10));
  });

  test('同じ時刻と鍵なら同じ値で、鍵が違えば違う値になる', () => {
    expect(deterministicUlid(AT, 'user:1')).toBe(
      deterministicUlid(AT, 'user:1'),
    );
    expect(deterministicUlid(AT, 'user:1')).not.toBe(
      deterministicUlid(AT, 'user:2'),
    );
  });

  test('時刻が遅いほど辞書順で後ろになる', () => {
    const later = new Date(AT.getTime() + 1);

    expect(deterministicUlid(AT, 'a') < deterministicUlid(later, 'a')).toBe(
      true,
    );
  });

  test('48ビットに収まらない時刻と負の時刻は例外にする', () => {
    expect(() => deterministicUlid(new Date(2 ** 48), 'a')).toThrow(RangeError);
    expect(() => deterministicUlid(new Date(-1), 'a')).toThrow(RangeError);
    expect(() => deterministicUlid(new Date(Number.NaN), 'a')).toThrow(
      RangeError,
    );
  });
});

describe('deterministicUuid', () => {
  test('バージョン4のUUIDの形式で、同じ鍵なら同じ値になる', () => {
    const id = deterministicUuid('pseudonymous:1');

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(deterministicUuid('pseudonymous:1')).toBe(id);
    expect(deterministicUuid('pseudonymous:2')).not.toBe(id);
  });
});

describe('deterministicInteger', () => {
  test('0以上で上限未満の整数を、同じ鍵なら同じ値で返す', () => {
    for (let index = 0; index < 200; index += 1) {
      const value = deterministicInteger(`k:${String(index)}`, 7);

      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
      expect(deterministicInteger(`k:${String(index)}`, 7)).toBe(value);
    }
  });

  test('鍵を変えると全ての値が現れる', () => {
    const seen = new Set(
      Array.from({ length: 200 }, (_, index) =>
        deterministicInteger(`k:${String(index)}`, 5),
      ),
    );

    expect(seen.size).toBe(5);
  });

  test('上限が正の整数でなければ例外にする', () => {
    expect(() => deterministicInteger('k', 0)).toThrow(RangeError);
    expect(() => deterministicInteger('k', 1.5)).toThrow(RangeError);
  });
});
