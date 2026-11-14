import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  AUTH_ERRORS,
  authError,
  CURRENT_PASSWORD_INCORRECT_MESSAGE,
  loginThrottledError,
  PASSWORD_LENGTH_MESSAGE,
  PWNED_PASSWORD_MESSAGE,
  REAUTHENTICATION_FAILED_CODE,
} from './auth-errors.ts';

describe('authError', () => {
  test.each([
    [
      'invalid_credentials',
      'unauthenticated',
      'メールアドレスまたはパスワードが正しくありません。',
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
      'totp_setup_expired',
      'unprocessable',
      '設定の有効期限が切れました。最初からやり直してください。',
    ],
    ['unauthenticated', 'unauthenticated', 'ログインが必要です。'],
    ['forbidden', 'forbidden', 'この操作はできません。'],
    ['not_found', 'not_found', '対象が見つかりません。'],
  ] as const)(
    '%sは種類%sと定めた文言のAppErrorになる',
    (code, kind, message) => {
      const error = authError(code);

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code, kind, message });
      expect(error.details).toBeUndefined();
    },
  );

  test('主体に依存しない8種類のエラーだけを持つ', () => {
    expect(Object.keys(AUTH_ERRORS).toSorted()).toEqual([
      'forbidden',
      'invalid_credentials',
      'invalid_link',
      'invalid_second_factor',
      'login_challenge_expired',
      'not_found',
      'totp_setup_expired',
      'unauthenticated',
    ]);
  });

  test('定義は書き換えられない', () => {
    expect(Object.isFrozen(AUTH_ERRORS)).toBe(true);
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

describe('本人確認とパスワードの拒否の文言', () => {
  test('入力規則の下限と上限のコードポイント数から長さの文言を組み立てる', () => {
    expect(PASSWORD_LENGTH_MESSAGE).toBe(
      'パスワードは8文字以上128文字以内で入力してください。',
    );
  });

  test('本人確認の失敗のコードと現在のパスワードの誤りの文言を定める', () => {
    expect(REAUTHENTICATION_FAILED_CODE).toBe('reauthentication_failed');
    expect(CURRENT_PASSWORD_INCORRECT_MESSAGE).toBe(
      '現在のパスワードが正しくありません。',
    );
  });

  test('漏洩したパスワードの文言を定める', () => {
    expect(PWNED_PASSWORD_MESSAGE).toBe(
      'このパスワードは過去に漏洩したことがあります。別のパスワードを設定してください。',
    );
  });
});
