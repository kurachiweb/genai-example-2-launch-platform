import { describe, expect, test } from 'bun:test';

import { ENTRY_COPY } from './tournament-entry-fixtures.ts';

describe('参加費の導線のテストの文言', () => {
  test('期限切れの文は、組み合わせ決定に間に合わなかったかで異なる', () => {
    expect(ENTRY_COPY.expiredMessage(false)).toBe('Testの期限切れ。');
    expect(ENTRY_COPY.expiredMessage(true)).toBe(
      'Testの組み合わせ決定に間に合いませんでした。',
    );
  });

  test('除外の文は、非公開化・停止と参加数の上限で異なる', () => {
    expect(ENTRY_COPY.excludedMessage('hidden_or_suspended')).toBe(
      'Testのプロダクトが公開されていないため除外されました。',
    );
    expect(ENTRY_COPY.excludedMessage('over_capacity')).toBe(
      'Testの参加数の上限により除外されました。',
    );
  });

  test('敗退の文は、敗退したラウンドの名前を含む', () => {
    expect(ENTRY_COPY.eliminatedMessage('準決勝')).toBe('Testの準決勝で敗退。');
  });
});
