import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  IDENTITY_ERRORS,
  identityError,
  loginThrottledError,
  PASSWORD_LENGTH_MESSAGE,
} from './identity-errors.ts';

describe('identityError', () => {
  test.each([
    [
      'registration_email_unavailable',
      'conflict',
      'このメールアドレスは登録できません。',
    ],
    [
      'invalid_credentials',
      'unauthenticated',
      'メールアドレスまたはパスワードが正しくありません。',
    ],
    [
      'account_unavailable',
      'forbidden',
      'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
    ],
    [
      'invalid_second_factor',
      'unauthenticated',
      '認証コードが正しくありません。',
    ],
    [
      'login_challenge_expired',
      'unauthenticated',
      '認証の有効期限が切れました。もう一度ログインしてください。',
    ],
    [
      'invalid_link',
      'unprocessable',
      'このリンクは無効か、有効期限が切れています。',
    ],
    [
      'email_not_verified',
      'forbidden',
      'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。',
    ],
    ['totp_already_enabled', 'conflict', '多要素認証は既に有効です。'],
    ['totp_not_enabled', 'conflict', '多要素認証は有効になっていません。'],
    [
      'totp_setup_expired',
      'unprocessable',
      '設定の有効期限が切れました。最初からやり直してください。',
    ],
    [
      'account_state_conflict',
      'conflict',
      '処理が重なりました。時間をおいて再度お試しください。',
    ],
    ['unauthenticated', 'unauthenticated', 'ログインが必要です。'],
    ['not_found', 'not_found', '対象が見つかりません。'],
    ['forbidden', 'forbidden', 'この操作はできません。'],
  ] as const)(
    '%sは種類%sと定めた文言のAppErrorになる',
    (code, kind, message) => {
      const error = identityError(code);

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code, kind, message });
      expect(error.details).toBeUndefined();
    },
  );

  test('ユースケースが投げる14種類のエラーを持つ', () => {
    expect(Object.keys(IDENTITY_ERRORS)).toHaveLength(14);
  });
});

describe('loginThrottledError', () => {
  test('待ち時間付きの429の種類のAppErrorになる', () => {
    expect(loginThrottledError(4)).toMatchObject({
      kind: 'rate_limited',
      code: 'login_throttled',
      message:
        'ログイン試行が続いたため、しばらく待ってから再度お試しください。',
      retryAfterSeconds: 4,
    });
  });
});

describe('PASSWORD_LENGTH_MESSAGE', () => {
  test('入力規則の下限と上限のコードポイント数から文言を組み立てる', () => {
    expect(PASSWORD_LENGTH_MESSAGE).toBe(
      'パスワードは8文字以上128文字以内で入力してください。',
    );
  });
});
