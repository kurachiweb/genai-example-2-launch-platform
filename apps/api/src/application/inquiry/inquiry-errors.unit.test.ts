import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  INQUIRY_ERRORS,
  inquiryCategoryNameRejectedError,
  inquiryCategoryNameTakenError,
  inquiryError,
} from './inquiry-errors.ts';

describe('INQUIRY_ERRORS', () => {
  test.each([
    [
      'member_inquiry_required',
      'forbidden',
      'ログイン中のため、このフォームは使えません。ページを再読み込みしてください。',
    ],
    ['inquiry_not_found', 'not_found', '問い合わせが見つかりません。'],
    [
      'inquiry_read_only',
      'conflict',
      '退会したユーザーの問い合わせのため、操作できません。',
    ],
    [
      'inquiry_not_repliable',
      'conflict',
      'ログインしていないユーザーの問い合わせには返信できません。',
    ],
    [
      'inquiry_state_conflict',
      'conflict',
      '処理が重なりました。画面を更新して再度お試しください。',
    ],
    [
      'inquiry_category_name_taken',
      'conflict',
      '同じ名前のカテゴリが既にあります。',
    ],
    [
      'inquiry_category_protected',
      'conflict',
      '標準カテゴリ「その他」は変更・削除できません。',
    ],
    ['inquiry_category_not_found', 'not_found', 'カテゴリが見つかりません。'],
  ] as const)('%sは%sの種類と設計の文言を持つ', (code, kind, message) => {
    const error = inquiryError(code);

    expect(error).toBeInstanceOf(AppError);
    expect({
      kind: error.kind,
      code: error.code,
      message: error.message,
    }).toEqual({ kind, code, message });
  });

  test('定義は実行時に書き換えられない', () => {
    expect(Object.isFrozen(INQUIRY_ERRORS)).toBe(true);
  });
});

describe('inquiryCategoryNameRejectedError', () => {
  test.each([
    ['forbidden-character', 'カテゴリ名に使用できない文字が含まれています。'],
    ['empty', 'カテゴリ名を入力してください。'],
    ['too-long', 'カテゴリ名は30文字以内で入力してください。'],
  ] as const)(
    '%sの違反を名前の欄の詳細を持つ検証のエラーにする',
    (issue, message) => {
      const error = inquiryCategoryNameRejectedError(issue);

      expect({
        kind: error.kind,
        code: error.code,
        message: error.message,
        details: error.details,
      }).toEqual({
        kind: 'bad_request',
        code: 'validation_error',
        message: '入力内容を確認してください。',
        details: [{ field: 'name', code: issue, message }],
      });
    },
  );
});

describe('inquiryCategoryNameTakenError', () => {
  test('名前の重複を名前の欄に示せる詳細付きの競合にする', () => {
    const error = inquiryCategoryNameTakenError();

    expect({
      kind: error.kind,
      code: error.code,
      message: error.message,
      details: error.details,
    }).toEqual({
      kind: 'conflict',
      code: 'inquiry_category_name_taken',
      message: '同じ名前のカテゴリが既にあります。',
      details: [
        {
          field: 'name',
          code: 'name-taken',
          message: '同じ名前のカテゴリが既にあります。',
        },
      ],
    });
  });
});
