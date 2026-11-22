import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../../../lib/core/errors/app-error.ts';
import {
  callerForbiddenError,
  INPUT_ARGUMENT,
  reportContactEmailFormatError,
  REPORTING_INPUT_MESSAGES,
} from './errors.ts';

function shapeOf(error: unknown): unknown {
  if (!(error instanceof AppError)) {
    throw new Error('AppErrorではありません');
  }
  return {
    kind: error.kind,
    code: error.code,
    message: error.message,
    details: error.details,
  };
}

describe('通報のスキーマモジュールのエラー', () => {
  test('呼び出し元の種類の違いを、権限の無い操作(forbidden)として拒否する', () => {
    expect(shapeOf(callerForbiddenError())).toMatchObject({
      kind: 'forbidden',
      code: 'forbidden',
    });
  });

  test('連絡先の形式の誤りを、連絡先の欄の詳細を持つ検証の誤りにする', () => {
    expect(shapeOf(reportContactEmailFormatError())).toEqual({
      kind: 'bad_request',
      code: 'validation_error',
      message: '入力内容を確認してください。',
      details: [
        {
          field: 'contactEmail',
          code: 'invalid-format',
          message: 'メールアドレスの形式が正しくありません。',
        },
      ],
    });
  });

  test('ユースケースが返す詳細の欄の前に付ける引数の名前はinputである', () => {
    expect(INPUT_ARGUMENT).toBe('input');
  });

  test('引数の形式の違反の文言は、文言規則の通報と通報管理の文言である', () => {
    expect(REPORTING_INPUT_MESSAGES).toEqual({
      pageSize: '表示する件数は1〜50件の整数で指定してください。',
      targetRefInvalid:
        '通報の対象が見つかりません。ページを読み込み直してください。',
      reportCategoryInvalid: 'カテゴリを選んでください。',
      reason: {
        ok: undefined,
        empty: '理由を入力してください。',
        'too-long': '理由は1,000文字以内で入力してください。',
      },
      contactEmailTooLong: 'メールアドレスは254文字以内で入力してください。',
      caseIdInvalid: '通報の案件が見つかりません。',
      categoryIdInvalid: 'カテゴリが見つかりません。',
      productIdInvalid: 'プロダクトが見つかりません。',
      periodReversed: '終了日には開始日と同じか後の日付を入力してください。',
      adminReasonTooLong: '理由は500文字以内で入力してください。',
      inquiryMessageTooLong: '照会の内容は1,000文字以内で入力してください。',
      categoryNameTooLong: 'カテゴリ名は30文字以内で入力してください。',
    });
  });
});
