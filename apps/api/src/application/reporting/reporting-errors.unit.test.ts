import { describe, expect, test } from 'bun:test';

import {
  AppError,
  STATUS_BY_KIND,
} from '../../../lib/core/errors/app-error.ts';
import {
  REPORTING_ERRORS,
  reportCategoryNameRejectedError,
  reportingError,
} from './reporting-errors.ts';

describe('reportingError', () => {
  test.each([
    [
      'report_category_not_found',
      'not_found',
      404,
      'カテゴリが見つかりません。',
    ],
    [
      'report_category_protected',
      'unprocessable',
      422,
      '標準のカテゴリは変更・削除できません。',
    ],
  ] as const)(
    '%sは種類%s(%d)と文言規則の文言のAppErrorになる',
    (code, kind, status, message) => {
      const error = reportingError(code);

      expect(error).toBeInstanceOf(AppError);
      expect(error.kind).toBe(kind);
      expect(STATUS_BY_KIND[error.kind]).toBe(status);
      expect(error.code).toBe(code);
      expect(error.message).toBe(message);
      expect(error.details).toBeUndefined();
    },
  );

  test('名前の重複は、画面が入力欄に理由を示せるよう名前の欄の詳細を持つ', () => {
    const error = reportingError('report_category_name_taken');

    expect(error.kind).toBe('conflict');
    expect(STATUS_BY_KIND[error.kind]).toBe(409);
    expect(error.message).toBe('同じ名前のカテゴリがあります。');
    expect(error.details).toEqual([
      {
        field: 'name',
        code: 'name-taken',
        message: '同じ名前のカテゴリがあります。',
      },
    ]);
  });

  test('定義は実行時に書き換えられない', () => {
    expect(Object.isFrozen(REPORTING_ERRORS)).toBe(true);
  });
});

describe('reportCategoryNameRejectedError', () => {
  test.each([
    ['empty', 'カテゴリ名を入力してください。'],
    ['too-long', 'カテゴリ名は30文字以内で入力してください。'],
    ['forbidden-character', 'カテゴリ名に使用できない文字が含まれています。'],
  ] as const)('%sを名前の欄の検証のエラーにする', (issue, message) => {
    const error = reportCategoryNameRejectedError(issue);

    expect({
      kind: error.kind,
      code: error.code,
      details: error.details,
    }).toEqual({
      kind: 'bad_request',
      code: 'validation_error',
      details: [{ field: 'name', code: issue, message }],
    });
  });
});
