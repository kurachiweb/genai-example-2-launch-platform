import { describe, expect, test } from 'bun:test';

import { weekEntryEliminatedMessage } from './week-entry-messages.ts';

describe('参加費の導線の文言', () => {
  test('敗退の文言は、敗退したラウンドの名前に続けて「で敗退しました。」と示す', () => {
    expect(weekEntryEliminatedMessage('準決勝')).toBe('準決勝で敗退しました。');
  });
});
