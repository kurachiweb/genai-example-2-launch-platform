import { describe, expect, test } from 'bun:test';

import {
  NO_FINALIZED_WEEK_MESSAGE,
  NO_PREVIOUS_WEEK_TEXT,
  NO_STATISTICS_MESSAGE,
  STATISTICS_DELTA_PREFIX,
  STATISTICS_IN_PROGRESS_LABEL,
  STATISTICS_LATEST_WEEK_SUFFIX,
  STATISTICS_METRIC_LABELS,
  STATISTICS_TABLE_CAPTION,
  STATISTICS_WEEK_START_COLUMN,
  STATISTICS_ZERO_DELTA_SIGN,
  WEEKLY_STATISTICS_DESCRIPTION,
  WEEKLY_STATISTICS_TITLE,
} from './statistics-messages.ts';

describe('週ごとの統計のカードの文言', () => {
  test('題名と説明は文言規則のとおりで、基準時刻の時差と集計の時刻を出さない', () => {
    expect(WEEKLY_STATISTICS_TITLE).toBe('週ごとの統計');
    expect(WEEKLY_STATISTICS_DESCRIPTION).toBe(
      '直近26週と集計中の今週の運営状況の推移です。週は月曜日に始まり、値は毎日集計します。終わった週の値は変わりません。',
    );
    expect(WEEKLY_STATISTICS_DESCRIPTION).not.toMatch(/UTC|時差|4:21/u);
  });

  test('指標の名前は文言規則の5つ', () => {
    expect(STATISTICS_METRIC_LABELS).toStrictEqual({
      netRevenue: '合計収益(税込)',
      users: 'ユーザー数',
      products: 'プロダクト数',
      qualifierMatches: '予選実施数',
      upvotes: 'Upvote数',
    });
  });

  test('直近の値の見出しは「<週の開始日>からの週」にする', () => {
    expect(`2026年11月9日(月)${STATISTICS_LATEST_WEEK_SUFFIX}`).toBe(
      '2026年11月9日(月)からの週',
    );
  });

  test('増減と状態の文言は文言規則のとおり', () => {
    expect(STATISTICS_DELTA_PREFIX).toBe('前週比');
    expect(STATISTICS_ZERO_DELTA_SIGN).toBe('±');
    expect(NO_PREVIOUS_WEEK_TEXT).toBe('前週の値なし');
    expect(NO_FINALIZED_WEEK_MESSAGE).toBe(
      '終わった週の統計はまだありません。',
    );
    expect(NO_STATISTICS_MESSAGE).toBe('統計はまだ集計されていません。');
  });

  test('表の名前と列と集計中の印は文言規則のとおり', () => {
    expect(STATISTICS_TABLE_CAPTION).toBe('週ごとの統計(直近26週と今週)');
    expect(STATISTICS_WEEK_START_COLUMN).toBe('週の開始日');
    expect(STATISTICS_IN_PROGRESS_LABEL).toBe('集計中');
  });
});
