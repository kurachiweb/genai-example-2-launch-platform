import { describe, expect, test } from 'bun:test';

import {
  AppError,
  STATUS_BY_KIND,
} from '../../../lib/core/errors/app-error.ts';
import {
  inquiryMessageRejectedError,
  REPORTING_ERRORS,
  reportAdminReasonRejectedError,
  reportCategoryMissingError,
  reportCategoryNameRejectedError,
  reportContactEmailRequiredError,
  reportingError,
  reportStatusUnchangedError,
} from './reporting-errors.ts';

describe('reportingError', () => {
  test.each([
    [
      'report_target_not_found',
      'not_found',
      404,
      '通報の対象が見つかりません。ページを読み込み直してください。',
    ],
    [
      'report_own_content',
      'unprocessable',
      422,
      '自分のコンテンツは通報できません。',
    ],
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
    ['report_case_not_found', 'not_found', 404, '通報の案件が見つかりません。'],
    [
      'report_case_closed',
      'unprocessable',
      422,
      'この案件は対応が完了しています。操作するには先に対応ステータスを戻してください。',
    ],
    [
      'report_case_state_conflict',
      'conflict',
      409,
      '他の操作で状態が変わりました。最新の内容を読み込んでからやり直してください。',
    ],
    [
      'report_inquiry_not_applicable',
      'unprocessable',
      422,
      'この案件では照会を送れません。',
    ],
    [
      'report_inquiry_send_failed',
      'unavailable',
      503,
      '照会を送れませんでした。時間をおいてやり直してください。',
    ],
    [
      'report_case_open_exists',
      'conflict',
      409,
      'この対象には未完了の別の案件があります。その案件で対応してください。',
    ],
    [
      'report_measure_already_applied',
      'unprocessable',
      422,
      '対象は既に非公開(停止中)です。措置なしで対応済にしてください。',
    ],
    [
      'report_target_unavailable',
      'unprocessable',
      422,
      '対象が見つかりません。措置なしで対応済にするか、却下してください。',
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

describe('通報の受け付けの欄の誤り', () => {
  test.each([
    [
      'カテゴリの不在',
      reportCategoryMissingError,
      'categoryId',
      'not-found',
      'カテゴリを選んでください。',
    ],
    [
      '連絡先の入れ忘れ',
      reportContactEmailRequiredError,
      'contactEmail',
      'required',
      '連絡先メールアドレスを入力してください。',
    ],
  ] as const)(
    '%sは欄の詳細を持つ検証のエラーになる',
    (_label, create, field, code, message) => {
      const error = create();

      expect({
        kind: error.kind,
        code: error.code,
        message: error.message,
        details: error.details,
      }).toEqual({
        kind: 'bad_request',
        code: 'validation_error',
        message: '入力内容を確認してください。',
        details: [{ field, code, message }],
      });
    },
  );
});

describe('案件の操作の欄の誤り', () => {
  test.each([
    [
      '理由の入れ忘れ',
      () => reportAdminReasonRejectedError('required'),
      'reason',
      'required',
      '理由を入力してください。',
    ],
    [
      '理由の文字数超過',
      () => reportAdminReasonRejectedError('too-long'),
      'reason',
      'too-long',
      '理由は500文字以内で入力してください。',
    ],
    [
      '照会の内容の入れ忘れ',
      () => inquiryMessageRejectedError('empty'),
      'message',
      'empty',
      '照会の内容を入力してください。',
    ],
    [
      '照会の内容の文字数超過',
      () => inquiryMessageRejectedError('too-long'),
      'message',
      'too-long',
      '照会の内容は1,000文字以内で入力してください。',
    ],
    [
      '現在と同じ対応ステータスへの変更',
      reportStatusUnchangedError,
      'status',
      'unchanged',
      '現在と異なる対応ステータスを選んでください。',
    ],
  ] as const)(
    '%sは文言規則の文言で欄の詳細を持つ検証のエラーになる',
    (_label, create, field, code, message) => {
      const error = create();

      expect({
        kind: error.kind,
        code: error.code,
        message: error.message,
        details: error.details,
      }).toEqual({
        kind: 'bad_request',
        code: 'validation_error',
        message: '入力内容を確認してください。',
        details: [{ field, code, message }],
      });
    },
  );
});
