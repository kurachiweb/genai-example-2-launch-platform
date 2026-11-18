import { describe, expect, test } from 'bun:test';

import {
  WEEK_ENTRY_COPY,
  weekEntryEliminatedMessage,
} from './week-entry-messages.ts';

describe('参加費の導線の文言', () => {
  test('敗退の文言は、敗退したラウンドの名前に続けて「で敗退しました。」と示す', () => {
    expect(weekEntryEliminatedMessage('準決勝')).toBe('準決勝で敗退しました。');
    expect(WEEK_ENTRY_COPY.eliminatedMessage('準決勝')).toBe(
      '準決勝で敗退しました。',
    );
  });

  test('期限切れは、予選の勝利が組み合わせ決定に間に合わなかったかで文を分ける', () => {
    expect(WEEK_ENTRY_COPY.expiredMessage(false)).toBe(
      '決済期限までに参加費の決済が無かったため参加できませんでした。',
    );
    expect(WEEK_ENTRY_COPY.expiredMessage(true)).toBe(
      '予選の勝利が組み合わせ決定に間に合わなかったため参加できませんでした。',
    );
  });

  test.each(['hidden_or_suspended', 'over_capacity'] as const)(
    'Weekに参加数の上限は無いため、除外の理由%sによらずプロダクトが公開されていなかった文を示す',
    (reason) => {
      expect(WEEK_ENTRY_COPY.excludedMessage(reason)).toBe(
        '組み合わせ決定の時点でプロダクトが公開されていなかったため参加できませんでした。',
      );
    },
  );
});
