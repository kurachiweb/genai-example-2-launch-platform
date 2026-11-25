import { describe, expect, test } from 'bun:test';

import type { ProductLockEntry } from '../product/decision-sources.ts';
import {
  AFTER_DRAW,
  BEFORE_DEADLINE,
  createYearDecisionFakes,
  DRAWING_YEAR_ROW,
  entryIdOf,
  entryOf,
  launchIdOf,
  NO_READS,
  productIdOf,
  STORED_SCHEDULE,
  subjectOf,
  type YearDecisionScenario,
  yearRowOf,
} from './testing/year-decision-fakes.ts';
import {
  YEAR_PRODUCT_LOCK_MESSAGE,
  YearProductLockSource,
} from './year-product-lock-source.ts';

function lockOf(index: number): ProductLockEntry {
  return {
    productId: productIdOf(index),
    code: 'tournament-year.bracket-lock',
    message: YEAR_PRODUCT_LOCK_MESSAGE,
  };
}

async function findLocks(
  scenario: YearDecisionScenario,
  at: Date,
  subjects = [subjectOf(1)],
) {
  const fakes = createYearDecisionFakes(scenario);
  const locks = await new YearProductLockSource(
    fakes.entries,
    fakes.brackets,
    fakes.calendar,
  ).findLocks({ subjects, at });
  return { locks, reads: fakes.reads };
}

describe('YearProductLockSource.findLocks', () => {
  test('文言は文言規則の「Yearトーナメントの勝ち残りの固定」', () => {
    expect(YEAR_PRODUCT_LOCK_MESSAGE).toBe(
      'Yearトーナメントに勝ち残っているため、ローンチ日・カテゴリの変更と削除はできません。',
    );
  });

  test('組み合わせで勝ち残っている枠のプロダクトを固定する(要件13.5)', async () => {
    const { locks } = await findLocks(
      {
        entries: [entryOf(1, 'drawn')],
        years: [yearRowOf({ status: 'in_progress' })],
        aliveRefs: [entryIdOf(1)],
      },
      AFTER_DRAW,
    );

    expect(locks).toEqual([lockOf(1)]);
  });

  test.each([
    ['組み合わせの対象の', entryOf(1, 'drawn')],
    ['分類前の参加資格を得た', entryOf(1, 'entitled')],
  ])(
    '凍結の後に組み合わせを書き終える前の年の%s枠のプロダクトを、組み合わせ決定の途中として固定する',
    async (_label, entry) => {
      const { locks } = await findLocks(
        { entries: [entry], years: [DRAWING_YEAR_ROW] },
        STORED_SCHEDULE.drawAt,
      );

      expect(locks).toEqual([lockOf(1)]);
    },
  );

  test.each([
    ['受付中の', entryOf(1, 'awaiting_payment'), yearRowOf(), BEFORE_DEADLINE],
    [
      '組み合わせ決定を待つ参加資格を得た',
      entryOf(1, 'entitled'),
      yearRowOf(),
      BEFORE_DEADLINE,
    ],
    [
      '組み合わせ決定中の年の受付中の',
      entryOf(1, 'awaiting_payment'),
      DRAWING_YEAR_ROW,
      STORED_SCHEDULE.drawAt,
    ],
    [
      '敗退した',
      entryOf(1, 'drawn'),
      yearRowOf({ status: 'in_progress' }),
      AFTER_DRAW,
    ],
    [
      '優勝した',
      entryOf(1, 'drawn'),
      yearRowOf({
        status: 'finished',
        outcome: 'awarded',
        championEntryId: entryIdOf(1),
        awardedAt: AFTER_DRAW,
      }),
      AFTER_DRAW,
    ],
    [
      '組み合わせ決定中の年の期限切れの',
      entryOf(1, 'expired', { closeReason: 'deadline' }),
      DRAWING_YEAR_ROW,
      STORED_SCHEDULE.drawAt,
    ],
    [
      '組み合わせ決定中の年の喪失した',
      entryOf(1, 'forfeited', { closeReason: 'deleted' }),
      DRAWING_YEAR_ROW,
      STORED_SCHEDULE.drawAt,
    ],
    [
      '組み合わせ決定中の年の除外された',
      entryOf(1, 'excluded', { closeReason: 'over_capacity' }),
      DRAWING_YEAR_ROW,
      STORED_SCHEDULE.drawAt,
    ],
  ])('%s枠は固定しない', async (_label, entry, year, at) => {
    const { locks } = await findLocks({ entries: [entry], years: [year] }, at);

    expect(locks).toEqual([]);
  });

  test('枠の無いローンチは固定せず、Week優勝も読まない', async () => {
    const { locks, reads } = await findLocks(
      { years: [DRAWING_YEAR_ROW] },
      STORED_SCHEDULE.drawAt,
    );

    expect(locks).toEqual([]);
    expect(reads.openPeriodReads).toEqual([]);
    expect(reads.championReads).toEqual([]);
  });

  test('直近のローンチが予選に勝利していない対象は読み取りもせずに固定しない', async () => {
    const { locks, reads } = await findLocks({}, AFTER_DRAW, [
      subjectOf(1, 'lost'),
      { ...subjectOf(2), latestLaunch: null },
    ]);

    expect(locks).toEqual([]);
    expect(reads).toEqual(NO_READS);
  });

  test('該当する対象と該当しない対象の混ざった一覧を、枠・勝ち残り・年の一括の読み取り1回ずつで判定し、該当するものだけを対象の順に返す', async () => {
    const { locks, reads } = await findLocks(
      {
        entries: [
          entryOf(1, 'drawn'),
          entryOf(2, 'drawn'),
          entryOf(3, 'entitled'),
          entryOf(4, 'drawn'),
        ],
        years: [yearRowOf({ status: 'in_progress' })],
        aliveRefs: [entryIdOf(2), entryIdOf(4)],
      },
      AFTER_DRAW,
      [subjectOf(1), subjectOf(2), subjectOf(3), subjectOf(4), subjectOf(5)],
    );

    expect(locks).toEqual([lockOf(2), lockOf(4)]);
    expect(reads.entryReads).toEqual([[1, 2, 3, 4, 5].map(launchIdOf)]);
    expect(reads.aliveReads).toEqual([
      { kind: 'year', refs: [entryIdOf(1), entryIdOf(2), entryIdOf(4)] },
    ]);
    expect(reads.calendarReads).toEqual([
      { years: [2026, 2027, 2028, 2029], now: AFTER_DRAW },
    ]);
    expect(reads.championReads).toEqual([]);
  });
});
