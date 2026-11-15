import { describe, expect, test } from 'bun:test';

import {
  currentEmailText,
  remainingRecoveryCodesMessage,
} from './account-messages.ts';

describe('自分のアカウントの文言', () => {
  test('現在のメールアドレスとリカバリコードの残数を文に含める', () => {
    expect(currentEmailText('operator@admin.example')).toBe(
      '現在のメールアドレス: operator@admin.example',
    );
    expect(remainingRecoveryCodesMessage(0)).toBe(
      '未使用のリカバリコードは残り0個です。',
    );
  });
});
