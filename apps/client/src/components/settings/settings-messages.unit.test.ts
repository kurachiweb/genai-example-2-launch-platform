import { describe, expect, test } from 'bun:test';

import {
  otherSessionsRevokedMessage,
  remainingRecoveryCodesMessage,
  sessionCountMessage,
} from './settings-messages.ts';

describe('件数を含む設定ページの文言', () => {
  test('ログイン中の端末の台数を示す', () => {
    expect(sessionCountMessage(3)).toBe('3台の端末でログインしています。');
  });

  test('ログアウトさせた端末の台数を示す', () => {
    expect(otherSessionsRevokedMessage(2)).toBe(
      '2台の端末をログアウトさせました。',
    );
  });

  test('未使用のリカバリコードの残りの個数を示す', () => {
    expect(remainingRecoveryCodesMessage(0)).toBe(
      '未使用のリカバリコードは残り0個です。',
    );
  });
});
