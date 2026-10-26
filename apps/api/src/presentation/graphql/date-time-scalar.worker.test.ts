import { Kind, type ValueNode } from 'graphql';
import { describe, expect, test } from 'vitest';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import { dateTimeScalar } from './date-time-scalar.ts';

const EPOCH_MILLISECONDS = Date.UTC(2026, 9, 26, 3, 4, 5, 678);
const UTC_TEXT = '2026-10-26T03:04:05.678Z';

function stringLiteral(value: string): ValueNode {
  return { kind: Kind.STRING, value };
}

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('例外が投げられませんでした');
}

describe('dateTimeScalar.serialize', () => {
  test('エポックミリ秒の数値をUTCのRFC 3339の文字列にする', () => {
    expect(dateTimeScalar.serialize(EPOCH_MILLISECONDS)).toBe(UTC_TEXT);
  });

  test('DateをUTCのRFC 3339の文字列にする', () => {
    expect(dateTimeScalar.serialize(new Date(EPOCH_MILLISECONDS))).toBe(
      UTC_TEXT,
    );
  });

  test.each([
    ['文字列', UTC_TEXT],
    ['非数', Number.NaN],
    ['無限大', Number.POSITIVE_INFINITY],
    ['小数のミリ秒', 1.5],
    ['不正なDate', new Date(Number.NaN)],
    ['4桁を超える年', Date.UTC(10_000, 0, 1)],
    ['紀元前の年', Date.UTC(-1, 0, 1)],
  ])('%sは出力できない', (_label, value) => {
    expect(() => dateTimeScalar.serialize(value)).toThrow(TypeError);
  });
});

describe('dateTimeScalar.parseValue', () => {
  test.each([
    ['UTC', '2026-10-26T03:04:05.678Z'],
    ['オフセット付き', '2026-10-26T12:04:05.678+09:00'],
    ['小文字の区切り', '2026-10-26t03:04:05.678z'],
  ])('%sのRFC 3339の文字列をエポックミリ秒にする', (_label, text) => {
    expect(dateTimeScalar.parseValue(text)).toBe(EPOCH_MILLISECONDS);
  });

  test('秒の小数を省略した文字列を受け付ける', () => {
    expect(dateTimeScalar.parseValue('2026-10-26T03:04:05-01:30')).toBe(
      Date.UTC(2026, 9, 26, 4, 34, 5),
    );
  });

  test.each([
    ['オフセットの無い文字列', '2026-10-26T03:04:05'],
    ['日付だけの文字列', '2026-10-26'],
    ['存在しない日付', '2026-02-30T00:00:00Z'],
    ['範囲外の時刻', '2026-10-26T24:00:00Z'],
    ['範囲外のオフセット', '2026-10-26T03:04:05+24:00'],
    ['UTCへ直すと0年より前になる日時', '0000-01-01T00:00:00+01:00'],
    ['日時でない文字列', 'yesterday'],
    ['数値', EPOCH_MILLISECONDS],
  ])('%sを入力不正として拒否する', (_label, value) => {
    const error = captureError(() => dateTimeScalar.parseValue(value));

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      kind: 'bad_request',
      code: 'validation_error',
    });
  });
});

describe('dateTimeScalar.parseLiteral', () => {
  test('文字列のリテラルをエポックミリ秒にする', () => {
    expect(dateTimeScalar.parseLiteral(stringLiteral(UTC_TEXT))).toBe(
      EPOCH_MILLISECONDS,
    );
  });

  test('文字列でないリテラルを入力不正として拒否する', () => {
    const error = captureError(() =>
      dateTimeScalar.parseLiteral({ kind: Kind.INT, value: '1' }),
    );

    expect(error).toMatchObject({
      kind: 'bad_request',
      code: 'validation_error',
    });
  });

  test('不正な日時の文字列のリテラルを入力不正として拒否する', () => {
    const error = captureError(() =>
      dateTimeScalar.parseLiteral(stringLiteral('2026-13-01T00:00:00Z')),
    );

    expect(error).toMatchObject({
      kind: 'bad_request',
      code: 'validation_error',
    });
  });
});
