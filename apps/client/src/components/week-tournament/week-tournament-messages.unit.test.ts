import { describe, expect, test } from 'bun:test';

import {
  weekBracketCountsLabel,
  weekBracketPageTitle,
  weekFinalAwardedMessage,
} from './week-tournament-messages.ts';

describe('Weekトーナメントの文言', () => {
  test('決勝の受賞の文言は、受賞したプロダクトの名称と賞の名前を示す', () => {
    expect(weekFinalAwardedMessage('Pitch Notes')).toBe(
      'フルタイム！Pitch NotesがProduct of the Weekを受賞🎉',
    );
  });

  test('ブラケットのページの題名は、週の期間の表記に続けてトーナメントの名前を示す', () => {
    expect(weekBracketPageTitle('2026年11月9日〜11月15日')).toBe(
      '2026年11月9日〜11月15日 Product of the Weekトーナメント',
    );
  });

  test('ブラケットの参加数とシード数は「参加<数>・シード<数>」で示す', () => {
    expect(weekBracketCountsLabel(6, 2)).toBe('参加6・シード2');
  });
});
