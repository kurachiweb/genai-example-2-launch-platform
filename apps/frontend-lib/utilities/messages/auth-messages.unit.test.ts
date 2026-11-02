import { describe, expect, test } from 'bun:test';

import {
  COPY_ALL_RECOVERY_CODES_LABEL,
  RECOVERY_CODES_COPIED,
  RECOVERY_CODES_COPY_FAILED,
  RECOVERY_CODES_LABEL,
  RECOVERY_CODES_STORAGE_NOTICE,
  SHOW_PASSWORD_LABEL,
  TOTP_QR_CODE_LABEL,
} from './auth-messages.ts';

describe('認証の画面部品の文言', () => {
  test('ボタンと一覧の名前は体言止めで「。」を付けない', () => {
    expect(SHOW_PASSWORD_LABEL).toBe('パスワードを表示');
    expect(COPY_ALL_RECOVERY_CODES_LABEL).toBe('すべてコピー');
    expect(RECOVERY_CODES_LABEL).toBe('リカバリコード');
    expect(TOTP_QR_CODE_LABEL).toBe('認証アプリで読み取るQRコード');
  });

  test('保管の注意は、認証アプリとリカバリコードの両方を失うと復旧できないことを示し、保管を促す', () => {
    expect(RECOVERY_CODES_STORAGE_NOTICE).toBe(
      '認証アプリとリカバリコードの両方を失うと、アカウントを復旧できません。リカバリコードは安全な場所に保管してください。各コードは1回だけ使えます。',
    );
  });

  test('コピーの結果の文言は文末に「。」を付け、失敗では代わりの手段を示す', () => {
    expect(RECOVERY_CODES_COPIED).toBe('リカバリコードをコピーしました。');
    expect(RECOVERY_CODES_COPY_FAILED).toBe(
      'コピーできませんでした。リカバリコードを選択してコピーするか、書き留めてください。',
    );
  });
});
