import { describe, expect, test } from 'bun:test';

import {
  AppError,
  STATUS_BY_KIND,
} from '../../../lib/core/errors/app-error.ts';
import { IDENTITY_ERRORS } from '../identity/identity-errors.ts';
import { MODERATION_ERRORS, moderationError } from './moderation-errors.ts';

describe('moderationError', () => {
  test.each([
    ['user_not_found', 'not_found', 404, '利用者が見つかりません。'],
    ['product_not_found', 'not_found', 404, 'プロダクトが見つかりません。'],
    [
      'comment_not_found',
      'not_found',
      404,
      'コメントが見つかりません。削除された可能性があります。',
    ],
    ['rating_not_found', 'not_found', 404, '評価が見つかりません。'],
    ['image_not_found', 'not_found', 404, '画像が見つかりません。'],
    [
      'image_action_not_applicable',
      'unprocessable',
      422,
      'この画像にはこの操作を行えません。',
    ],
    [
      'account_state_conflict',
      'conflict',
      409,
      '他の操作で状態が変わりました。最新の内容を読み込んでからやり直してください。',
    ],
  ] as const)(
    '%sは種類%s(%d)と文言規則の文言のAppErrorになる',
    (code, kind, status, message) => {
      const error = moderationError(code);

      expect(error).toBeInstanceOf(AppError);
      expect(error.kind).toBe(kind);
      expect(STATUS_BY_KIND[error.kind]).toBe(status);
      expect(error.code).toBe(code);
      expect(error.message).toBe(message);
      expect(error.details).toBeUndefined();
    },
  );

  test('措置の確定の競合は上流と同じコードで、一覧の読み直しを案内する本specの文言にする', () => {
    expect(MODERATION_ERRORS.account_state_conflict.kind).toBe(
      IDENTITY_ERRORS.account_state_conflict.kind,
    );
    expect(MODERATION_ERRORS.account_state_conflict.message).not.toBe(
      IDENTITY_ERRORS.account_state_conflict.message,
    );
  });

  test('定義は実行時に書き換えられない', () => {
    expect(Object.isFrozen(MODERATION_ERRORS)).toBe(true);
  });
});
