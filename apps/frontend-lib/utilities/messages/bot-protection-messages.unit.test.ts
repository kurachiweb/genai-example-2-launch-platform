import { describe, expect, test } from 'bun:test';

import { BOT_CHECK_FAILED_MESSAGE } from './bot-protection-messages.ts';

describe('bot判定の文言', () => {
  test('判定の失敗は、文言規則の表とbackend-libのTurnstileの検証の失敗と同じ文言', () => {
    expect(BOT_CHECK_FAILED_MESSAGE).toBe(
      '認証に失敗しました。ページを再読み込みして再度お試しください。',
    );
  });
});
