import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../../../lib/core/errors/app-error.ts';
import { MODERATION_ERRORS } from '../../../../application/moderation/moderation-errors.ts';
import { toModerationError } from './errors.ts';

function appErrorOf(error: unknown): {
  readonly kind: string;
  readonly code: string;
  readonly message: string;
} {
  if (!(error instanceof AppError)) {
    throw new Error('AppErrorではありません');
  }
  return { kind: error.kind, code: error.code, message: error.message };
}

describe('toModerationError', () => {
  test('画像用でない用途の個別の隔離で上流が投げるquarantine_not_applicableを、画像が見つからないエラーへ写す', () => {
    const upstream = new AppError({
      kind: 'bad_request',
      code: 'quarantine_not_applicable',
      message: 'この画像は隔離できません。',
    });

    expect(appErrorOf(toModerationError(upstream))).toEqual({
      kind: 'not_found',
      code: 'image_not_found',
      message: '画像が見つかりません。',
    });
  });

  test('上流の文言のままのaccount_state_conflictを、管理画面の読み直しを案内する本機能の文言へ写す', () => {
    const upstream = new AppError({
      kind: 'conflict',
      code: 'account_state_conflict',
      message: '処理が重なりました。時間をおいて再度お試しください。',
    });

    expect(appErrorOf(toModerationError(upstream))).toEqual({
      kind: 'conflict',
      code: 'account_state_conflict',
      message: MODERATION_ERRORS.account_state_conflict.message,
    });
  });

  test.each([
    new AppError({
      kind: 'bad_request',
      code: 'invalid_cursor',
      message: 'ページの位置の指定が正しくありません。',
    }),
    new AppError({
      kind: 'unavailable',
      code: 'storage_unavailable',
      message: '一時的に画像を扱えません。',
    }),
    new AppError({
      kind: 'not_found',
      code: 'user_not_found',
      message: MODERATION_ERRORS.user_not_found.message,
    }),
    new Error('想定外の失敗'),
    'string',
  ])('写す対象でない失敗(%p)は同じ値のまま返す', (error) => {
    expect(toModerationError(error)).toBe(error);
  });
});
