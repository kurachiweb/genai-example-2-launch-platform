import { describe, expect, test } from 'bun:test';

import {
  YEAR_ENTRY_COPY,
  yearEntryIntroMessage,
} from './year-entry-messages.ts';

describe('Yearトーナメントの参加費の導線の文言', () => {
  test('見出しは「Product of the Yearトーナメント」、ボタンは「Yearトーナメントに参加」である', () => {
    expect(YEAR_ENTRY_COPY.title).toBe('Product of the Yearトーナメント');
    expect(YEAR_ENTRY_COPY.entryButton).toBe('Yearトーナメントに参加');
  });

  test('受付中の案内は、Week優勝の週と対象年を示し、決勝日の前後に分ける', () => {
    expect(
      yearEntryIntroMessage('2026年第37週(9/7〜9/13)', '2027年'),
    ).toStrictEqual({
      before:
        '2026年第37週(9/7〜9/13)のProduct of the Week受賞により、2027年のYearトーナメントに参加できます。決勝は',
      after: 'です。',
    });
  });

  test('期限切れは、組み合わせ決定の後のWeek優勝の反映かで文を分ける', () => {
    expect(YEAR_ENTRY_COPY.expiredMessage(false)).toBe(
      '決済期限までに参加費の決済が無かったため参加できませんでした。',
    );
    expect(YEAR_ENTRY_COPY.expiredMessage(true)).toBe(
      '組み合わせ決定の後にWeek優勝が反映されたため参加できませんでした。',
    );
  });

  test('除外は、非公開化・停止と参加数の上限で文を分け、返金の文は喪失と同じ文である', () => {
    expect(YEAR_ENTRY_COPY.excludedMessage('hidden_or_suspended')).toBe(
      '組み合わせ決定の時点でプロダクトが公開されていなかったため参加できませんでした。',
    );
    expect(YEAR_ENTRY_COPY.excludedMessage('over_capacity')).toBe(
      '参加数の上限(64)を超えたため参加できませんでした。',
    );
    expect(YEAR_ENTRY_COPY.excludedRefundSuffix).toBe(
      '参加費は自動で全額返金されます。',
    );
    expect(YEAR_ENTRY_COPY.forfeitedRefundSuffix).toBe(
      '参加費は自動で全額返金されます。',
    );
  });

  test('敗退の文言は、敗退したラウンドの名前に続けて「で敗退しました。」と示す', () => {
    expect(YEAR_ENTRY_COPY.eliminatedMessage('準決勝')).toBe(
      '準決勝で敗退しました。',
    );
  });
});
