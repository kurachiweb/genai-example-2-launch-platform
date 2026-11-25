import { describe, expect, test } from 'bun:test';

import type { ProductLockEntry } from '../product/decision-sources.ts';
import {
  BEFORE_DEADLINE,
  createWeekDecisionFakes,
  entryIdOf,
  entryOf,
  launchIdOf,
  productIdOf,
  RULE_WINDOW,
  subjectOf,
  tournamentOf,
  WEEK_START,
  type WeekDecisionScenario,
} from './testing/week-decision-fakes.ts';
import {
  WEEK_PRODUCT_LOCK_MESSAGE,
  WeekProductLockSource,
} from './week-product-lock-source.ts';

const AFTER_DRAW = new Date(RULE_WINDOW.drawAt.getTime() + 86_400_000);

function lockOf(index: number): ProductLockEntry {
  return {
    productId: productIdOf(index),
    code: 'tournament-week.bracket-lock',
    message: WEEK_PRODUCT_LOCK_MESSAGE,
  };
}

async function findLocks(
  scenario: WeekDecisionScenario,
  at: Date,
  subjects = [subjectOf(1)],
) {
  const fakes = createWeekDecisionFakes(scenario);
  const locks = await new WeekProductLockSource(
    fakes.store,
    fakes.brackets,
  ).findLocks({ subjects, at });
  return { locks, reads: fakes.reads };
}

describe('WeekProductLockSource.findLocks', () => {
  test('文言は文言規則の「Weekトーナメントの勝ち残りの固定」', () => {
    expect(WEEK_PRODUCT_LOCK_MESSAGE).toBe(
      'Weekトーナメントに勝ち残っているため、ローンチ日・カテゴリの変更と削除はできません。',
    );
  });

  test('組み合わせで勝ち残っている枠のプロダクトを固定する(要件11.5)', async () => {
    const { locks } = await findLocks(
      {
        entries: [entryOf(1, 'drawn')],
        tournaments: [tournamentOf({ status: 'in_progress' })],
        aliveRefs: [entryIdOf(1)],
      },
      AFTER_DRAW,
    );

    expect(locks).toEqual([lockOf(1)]);
  });

  test('凍結の後に組み合わせを書き終える前の組み合わせの対象の枠のプロダクトを固定する', async () => {
    const { locks } = await findLocks(
      {
        entries: [entryOf(1, 'drawn')],
        tournaments: [
          tournamentOf({
            status: 'drawing',
            drawStartedAt: RULE_WINDOW.drawAt,
          }),
        ],
      },
      RULE_WINDOW.drawAt,
    );

    expect(locks).toEqual([lockOf(1)]);
  });

  test.each([
    ['受付中', entryOf(1, 'awaiting_payment'), tournamentOf(), BEFORE_DEADLINE],
    ['参加資格を得た', entryOf(1, 'entitled'), tournamentOf(), BEFORE_DEADLINE],
    [
      '敗退した',
      entryOf(1, 'drawn'),
      tournamentOf({ status: 'in_progress' }),
      AFTER_DRAW,
    ],
    [
      '優勝した',
      entryOf(1, 'drawn'),
      tournamentOf({
        status: 'finished',
        outcome: 'awarded',
        championEntryId: entryIdOf(1),
        awardedAt: AFTER_DRAW,
      }),
      AFTER_DRAW,
    ],
    [
      '組み合わせ決定中の週で分類前の参加資格を得た',
      entryOf(1, 'entitled'),
      tournamentOf({ status: 'drawing', drawStartedAt: RULE_WINDOW.drawAt }),
      RULE_WINDOW.drawAt,
    ],
  ])('%s枠は固定しない', async (_label, entry, tournament, at) => {
    const { locks } = await findLocks(
      { entries: [entry], tournaments: [tournament] },
      at,
    );

    expect(locks).toEqual([]);
  });

  test('直近のローンチが予選に勝利していない対象は読み取りもせずに固定しない', async () => {
    const { locks, reads } = await findLocks({}, AFTER_DRAW, [
      subjectOf(1, 'lost'),
      { ...subjectOf(2), latestLaunch: null },
    ]);

    expect(locks).toEqual([]);
    expect(reads).toEqual({ entryReads: [], weekReads: [], aliveReads: [] });
  });

  test('該当する対象と該当しない対象の混ざった一覧を、枠・週・勝ち残りの一括の読み取り1回ずつで判定し、該当するものだけを対象の順に返す', async () => {
    const { locks, reads } = await findLocks(
      {
        entries: [
          entryOf(1, 'drawn'),
          entryOf(2, 'drawn'),
          entryOf(3, 'entitled'),
          entryOf(4, 'drawn'),
        ],
        tournaments: [tournamentOf({ status: 'in_progress' })],
        aliveRefs: [entryIdOf(2), entryIdOf(4)],
      },
      AFTER_DRAW,
      [subjectOf(1), subjectOf(2), subjectOf(3), subjectOf(4), subjectOf(5)],
    );

    expect(locks).toEqual([lockOf(2), lockOf(4)]);
    expect(reads.entryReads).toEqual([[1, 2, 3, 4, 5].map(launchIdOf)]);
    expect(reads.weekReads).toEqual([[WEEK_START]]);
    expect(reads.aliveReads).toEqual([
      { kind: 'week', refs: [entryIdOf(1), entryIdOf(2), entryIdOf(4)] },
    ]);
  });
});
