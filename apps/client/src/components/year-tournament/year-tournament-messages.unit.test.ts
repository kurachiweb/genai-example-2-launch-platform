import { describe, expect, test } from 'bun:test';

import {
  YEAR_BOARD_COPY,
  YEAR_BRACKET_COPY,
  YEAR_FINAL_COPY,
  yearBracketPageTitle,
} from './year-tournament-messages.ts';

describe('Yearトーナメントの文言', () => {
  test('トップページの区画の見出しの名前は「Product of the Yearトーナメント」である', () => {
    expect(YEAR_BOARD_COPY.sectionTitle).toBe(
      'Product of the Yearトーナメント',
    );
  });

  test('決勝の区画は「Year Final」の印・「Product of the Year」・「トーナメント決勝」の見出しを持つ', () => {
    expect(YEAR_FINAL_COPY.badge).toBe('Year Final');
    expect(YEAR_FINAL_COPY.title).toBe('Product of the Year');
    expect(YEAR_FINAL_COPY.subtitle).toBe('トーナメント決勝');
  });

  test('決勝の受賞の文言は、受賞したプロダクトの名称と賞の名前を示し、受賞なしは両者敗北を示す', () => {
    expect(YEAR_FINAL_COPY.awarded('Pitch Notes')).toBe(
      'フルタイム！Pitch NotesがProduct of the Yearを受賞🎉',
    );
    expect(YEAR_FINAL_COPY.noAward).toBe(
      'フルタイム。0対0で両者敗北。今回の受賞プロダクトはありません',
    );
  });

  test('ブラケットのページの題名は「<年>年のProduct of the Yearトーナメント」で、見出しと優勝の印はトーナメントと賞の名前である', () => {
    expect(yearBracketPageTitle('2027年')).toBe(
      '2027年のProduct of the Yearトーナメント',
    );
    expect(YEAR_BRACKET_COPY.title).toBe('Product of the Yearトーナメント');
    expect(YEAR_BRACKET_COPY.awardName).toBe('Product of the Year');
  });

  test('ブラケットの参加数とシード数は「参加<数>・シード<数>」で示す', () => {
    expect(YEAR_BRACKET_COPY.counts(13, 3)).toBe('参加13・シード3');
  });

  test('ブラケットの取得の失敗は、再試行と問い合わせを促す', () => {
    expect(YEAR_BRACKET_COPY.error).toBe(
      'ブラケットを読み込めませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。',
    );
  });
});
