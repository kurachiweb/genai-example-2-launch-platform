import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { createUlidGenerator } from './id-generator.ts';
import {
  isUppercaseUlid,
  UPPERCASE_ULID_PATTERN,
  UPPERCASE_ULID_SOURCE,
} from './uppercase-ulid.ts';

const VALID_ULID = '01JABCDEFGHJKMNPQRSTVWXYZ0';

describe('isUppercaseUlid', () => {
  test('採番したULIDを受け付ける', () => {
    const generator = createUlidGenerator({ now: () => new Date() });

    expect(isUppercaseUlid(generator.generate())).toBe(true);
  });

  test('Crockford Base32の大文字26文字を受け付ける', () => {
    expect(isUppercaseUlid(VALID_ULID)).toBe(true);
    expect(isUppercaseUlid('7ZZZZZZZZZZZZZZZZZZZZZZZZZ')).toBe(true);
  });

  test('小文字を含むULIDを受け付けない', () => {
    expect(isUppercaseUlid(VALID_ULID.toLowerCase())).toBe(false);
    expect(isUppercaseUlid(`${VALID_ULID.slice(0, 25)}z`)).toBe(false);
  });

  test('Crockford Base32に無い文字I・L・O・Uを含む値を受け付けない', () => {
    for (const letter of ['I', 'L', 'O', 'U']) {
      expect(isUppercaseUlid(`${VALID_ULID.slice(0, 25)}${letter}`)).toBe(
        false,
      );
    }
  });

  test('26文字でない値を受け付けない', () => {
    expect(isUppercaseUlid(VALID_ULID.slice(0, 25))).toBe(false);
    expect(isUppercaseUlid(`${VALID_ULID}0`)).toBe(false);
    expect(isUppercaseUlid('')).toBe(false);
  });

  test('前後に別の文字や改行が付いた値を受け付けない', () => {
    expect(isUppercaseUlid(` ${VALID_ULID}`)).toBe(false);
    expect(isUppercaseUlid(`${VALID_ULID}\n`)).toBe(false);
    expect(isUppercaseUlid(`award:${VALID_ULID}`)).toBe(false);
  });

  test('ASCIIの外の文字を含む値を受け付けない', () => {
    expect(isUppercaseUlid(`${VALID_ULID.slice(0, 25)}Ａ`)).toBe(false);
    expect(isUppercaseUlid(`${VALID_ULID.slice(0, 24)}😀`)).toBe(false);
  });

  test('同じ値で繰り返し判定しても結果が変わらない', () => {
    expect(isUppercaseUlid(VALID_ULID)).toBe(true);
    expect(isUppercaseUlid(VALID_ULID)).toBe(true);
  });
});

describe('UPPERCASE_ULID_PATTERN', () => {
  test('zodの文字列の規則に渡すと、大文字のULIDだけを受け付ける', () => {
    const schema = z.ulid().regex(UPPERCASE_ULID_PATTERN);

    expect(schema.safeParse(VALID_ULID).success).toBe(true);
    expect(schema.safeParse(VALID_ULID.toLowerCase()).success).toBe(false);
  });
});

describe('UPPERCASE_ULID_SOURCE', () => {
  const cursorPattern = new RegExp(
    String.raw`^(\d{1,15}):(${UPPERCASE_ULID_SOURCE})$`,
    'u',
  );

  test('複合の正規表現に組み込むと、大文字のULIDの部分を取り出す', () => {
    expect(cursorPattern.exec(`1:${VALID_ULID}`)?.slice(1)).toEqual([
      '1',
      VALID_ULID,
    ]);
  });

  test('複合の正規表現に組み込んでも、小文字とI・L・O・Uを含む値を受け付けない', () => {
    expect(cursorPattern.test(`1:${VALID_ULID.toLowerCase()}`)).toBe(false);
    for (const letter of ['I', 'L', 'O', 'U']) {
      expect(cursorPattern.test(`1:${VALID_ULID.slice(0, 25)}${letter}`)).toBe(
        false,
      );
    }
  });

  test('全体を照合する規則と同じ文字の並びだけを表す', () => {
    expect(UPPERCASE_ULID_PATTERN.source).toBe(`^${UPPERCASE_ULID_SOURCE}$`);
  });
});
