import { describe, expect, test } from 'bun:test';

import {
  AppError,
  STATUS_BY_KIND,
} from '../../../lib/core/errors/app-error.ts';
import {
  HELP_ERRORS,
  helpCategoryMissingError,
  helpCategoryNameRejectedError,
  helpError,
} from './help-errors.ts';

const HANDLE_TAKEN_MESSAGE =
  'このハンドルは既に使われています。別の文字列を入力してください。';

// 文言規則(docs/GUIDES/service/design/003-text-and-copy-rules.md)のエラーメッセージと一字一句同じ値
const EXPECTED = [
  ['help_article_handle_unavailable', 'conflict', 409, HANDLE_TAKEN_MESSAGE],
  [
    'help_article_conflict',
    'conflict',
    409,
    'このヘルプ記事は別の画面で変更されました。最新の内容を読み込んでから保存してください。',
  ],
  [
    'help_article_not_found',
    'not_found',
    404,
    'このヘルプ記事は削除されています。',
  ],
  [
    'help_order_outdated',
    'conflict',
    409,
    '並び順が別の画面で変更されました。最新の並びを読み込んでから並べ替えてください。',
  ],
  [
    'help_category_name_taken',
    'conflict',
    409,
    '同じ名前のカテゴリが既にあります。',
  ],
  [
    'help_category_protected',
    'conflict',
    409,
    '標準カテゴリ「その他」は変更・削除できません。',
  ],
  [
    'help_category_not_found',
    'not_found',
    404,
    'このカテゴリは削除されています。',
  ],
] as const;

describe('helpError', () => {
  test('対応表は設計のError Handlingの表のヘルプのコードだけを持つ', () => {
    expect(Object.keys(HELP_ERRORS).toSorted()).toEqual(
      EXPECTED.map(([code]) => code).toSorted(),
    );
  });

  test.each(EXPECTED)(
    '%sは%s(%i)のAppErrorで、文言は文言規則と一致する',
    (code, kind, status, message) => {
      const error = helpError(code);

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe(code);
      expect(error.kind).toBe(kind);
      expect(STATUS_BY_KIND[error.kind]).toBe(status);
      expect(error.message).toBe(message);
    },
  );

  test('ハンドルの使用中はハンドル欄の詳細を持つ', () => {
    expect(helpError('help_article_handle_unavailable').details).toEqual([
      { field: 'handle', code: 'unavailable', message: HANDLE_TAKEN_MESSAGE },
    ]);
  });

  test('カテゴリ名の重複はカテゴリ名の欄の詳細を持つ', () => {
    expect(helpError('help_category_name_taken').details).toEqual([
      {
        field: 'name',
        code: 'name-taken',
        message: '同じ名前のカテゴリが既にあります。',
      },
    ]);
  });

  test.each([
    'help_article_conflict',
    'help_article_not_found',
    'help_order_outdated',
    'help_category_protected',
    'help_category_not_found',
  ] as const)('%sは欄の詳細を持たない', (code) => {
    expect(helpError(code).details).toBeUndefined();
  });

  test('定義は実行時に書き換えられない', () => {
    expect(Object.isFrozen(HELP_ERRORS)).toBe(true);
  });
});

describe('helpCategoryMissingError', () => {
  test('保存の時点で無いカテゴリは、カテゴリの欄の入力の検証のエラーにする', () => {
    const error = helpCategoryMissingError();

    expect(error.kind).toBe('bad_request');
    expect(error.code).toBe('validation_error');
    expect(error.message).toBe('入力内容を確認してください。');
    expect(error.details).toEqual([
      {
        field: 'categoryId',
        code: 'not-found',
        message: 'カテゴリを選択してください。',
      },
    ]);
  });
});

describe('helpCategoryNameRejectedError', () => {
  test.each([
    ['empty', 'カテゴリ名を入力してください。'],
    ['too-long', 'カテゴリ名は30文字以内で入力してください。'],
    ['forbidden-character', 'カテゴリ名に使用できない文字が含まれています。'],
  ] as const)(
    'カテゴリ名の%sは、名前の欄の入力の検証のエラーにする',
    (issue, message) => {
      const error = helpCategoryNameRejectedError(issue);

      expect(error.kind).toBe('bad_request');
      expect(error.code).toBe('validation_error');
      expect(error.details).toEqual([{ field: 'name', code: issue, message }]);
    },
  );
});
