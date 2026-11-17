import { describe, expect, test } from 'bun:test';

import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import {
  defaultFinalDate,
  yearScheduleFor,
} from '../../../lib/core/year-tournament/year-schedule.ts';
import type { RelaunchBlock } from '../product/decision-sources.ts';
import {
  AFTER_DRAW,
  BEFORE_DEADLINE,
  championOf,
  createYearDecisionFakes,
  DEFAULT_SCHEDULE,
  DRAWING_YEAR_ROW,
  entryIdOf,
  entryOf,
  launchIdOf,
  NO_READS,
  OPEN_PERIOD_START,
  productIdOf,
  STORED_SCHEDULE,
  subjectOf,
  YEAR,
  type YearDecisionScenario,
  yearRowOf,
} from './testing/year-decision-fakes.ts';
import {
  YEAR_RELAUNCH_BLOCK_MESSAGES,
  YearRelaunchConditionSource,
} from './year-relaunch-condition-source.ts';

function entryPendingOf(index: number, releaseAt: Date): RelaunchBlock {
  return {
    productId: productIdOf(index),
    code: 'tournament-year.entry-pending',
    message: YEAR_RELAUNCH_BLOCK_MESSAGES.entryPending,
    releaseAt,
  };
}

function resultPendingOf(index: number): RelaunchBlock {
  return {
    productId: productIdOf(index),
    code: 'tournament-year.result-pending',
    message: YEAR_RELAUNCH_BLOCK_MESSAGES.resultPending,
    releaseAt: null,
  };
}

async function findBlocks(
  scenario: YearDecisionScenario,
  at: Date,
  subjects = [subjectOf(1)],
) {
  const fakes = createYearDecisionFakes(scenario);
  const blocks = await new YearRelaunchConditionSource(
    fakes.entries,
    fakes.brackets,
    fakes.calendar,
    fakes.champions,
  ).findBlocks({ subjects, at });
  return { blocks, reads: fakes.reads };
}

describe('YearRelaunchConditionSource.findBlocks', () => {
  test('文言は文言規則の「再ローンチ不可(Year・参加前)」「同(Year・参加中)」の定型の部分', () => {
    expect(YEAR_RELAUNCH_BLOCK_MESSAGES).toEqual({
      entryPending:
        'このプロダクトはYearトーナメントに参加できる期間中のため再ローンチできません。',
      resultPending:
        'このプロダクトはYearトーナメント参加中のため再ローンチできません。',
    });
  });

  describe('受付中の枠(要件13.1)', () => {
    test('対象年の行の保存した決済期限の1ミリ秒前までは、その期限を解除の日時として禁止する', async () => {
      const { blocks } = await findBlocks(
        { entries: [entryOf(1, 'awaiting_payment')], years: [yearRowOf()] },
        BEFORE_DEADLINE,
      );

      expect(blocks).toEqual([entryPendingOf(1, STORED_SCHEDULE.deadlineAt)]);
    });

    test('保存した決済期限ちょうどからは禁止を返さない(要件13.3)', async () => {
      const { blocks } = await findBlocks(
        { entries: [entryOf(1, 'awaiting_payment')], years: [yearRowOf()] },
        STORED_SCHEDULE.deadlineAt,
      );

      expect(blocks).toEqual([]);
    });

    test('対象年の行が無ければ、既定の決勝日から求めた決済期限の前まで禁止する', async () => {
      const before = await findBlocks(
        { entries: [entryOf(1, 'awaiting_payment')] },
        new Date(DEFAULT_SCHEDULE.deadlineAt.getTime() - 1),
      );
      const atDeadline = await findBlocks(
        { entries: [entryOf(1, 'awaiting_payment')] },
        DEFAULT_SCHEDULE.deadlineAt,
      );

      expect(before.blocks).toEqual([
        entryPendingOf(1, DEFAULT_SCHEDULE.deadlineAt),
      ]);
      expect(atDeadline.blocks).toEqual([]);
    });

    test('対象年の組み合わせ決定が始まった後の受付中の枠は禁止を返さない', async () => {
      const { blocks } = await findBlocks(
        {
          entries: [entryOf(1, 'awaiting_payment')],
          years: [DRAWING_YEAR_ROW],
        },
        STORED_SCHEDULE.drawAt,
      );

      expect(blocks).toEqual([]);
    });
  });

  describe('決勝実施日の変更(要件13.6)', () => {
    test('決勝日を後ろへ変えた年は、既定の決済期限を過ぎても変更後の決済期限を解除の日時として禁止する', async () => {
      const { blocks } = await findBlocks(
        { entries: [entryOf(1, 'awaiting_payment')], years: [yearRowOf()] },
        DEFAULT_SCHEDULE.deadlineAt,
      );

      expect(blocks).toEqual([entryPendingOf(1, STORED_SCHEDULE.deadlineAt)]);
    });

    test('決勝日を前へ変えた年は、変更後の決済期限からは既定の決済期限の前でも禁止を返さない', async () => {
      const earlier = yearScheduleFor(YEAR, parseBusinessDate('2027-05-16'));
      const scenario = {
        entries: [entryOf(1, 'awaiting_payment')],
        years: [yearRowOf({ schedule: earlier })],
      };

      const before = await findBlocks(
        scenario,
        new Date(earlier.deadlineAt.getTime() - 1),
      );
      const after = await findBlocks(scenario, earlier.deadlineAt);

      expect(before.blocks).toEqual([entryPendingOf(1, earlier.deadlineAt)]);
      expect(after.blocks).toEqual([]);
    });
  });

  describe('Week優勝の確定から枠の作成までの間(要件13.4)', () => {
    test('枠の無いWeek優勝したローンチを受付中の枠と同じに扱い、対象年の決済期限の前まで禁止する', async () => {
      const scenario = {
        years: [yearRowOf()],
        champions: [championOf(1)],
        openPeriodStart: OPEN_PERIOD_START,
      };

      const before = await findBlocks(scenario, BEFORE_DEADLINE);
      const atDeadline = await findBlocks(scenario, STORED_SCHEDULE.deadlineAt);

      expect(before.blocks).toEqual([
        entryPendingOf(1, STORED_SCHEDULE.deadlineAt),
      ]);
      expect(before.reads.openPeriodReads).toEqual([BEFORE_DEADLINE]);
      expect(before.reads.championReads).toEqual([
        { awardedFrom: OPEN_PERIOD_START, awardedBefore: BEFORE_DEADLINE },
      ]);
      expect(atDeadline.blocks).toEqual([]);
    });

    test('対象年の決済期限日の後のWeek優勝は、翌年の決済期限を解除の日時にする', async () => {
      const nextYear = yearScheduleFor(YEAR + 1, defaultFinalDate(YEAR + 1));
      const awardedAt = fromBusinessDateTime(parseBusinessDate('2027-06-20'), {
        hour: 22,
        minute: 0,
      });
      const at = new Date(awardedAt.getTime() + 3_600_000);

      const { blocks } = await findBlocks(
        {
          years: [
            yearRowOf({
              status: 'in_progress',
              drawStartedAt: STORED_SCHEDULE.drawAt,
            }),
          ],
          champions: [championOf(1, awardedAt)],
          openPeriodStart: OPEN_PERIOD_START,
        },
        at,
      );

      expect(blocks).toEqual([entryPendingOf(1, nextYear.deadlineAt)]);
    });

    test('対象年の組み合わせ決定が始まった後(遅れ)のWeek優勝は禁止を返さない', async () => {
      const { blocks } = await findBlocks(
        {
          years: [DRAWING_YEAR_ROW],
          champions: [championOf(1)],
          openPeriodStart: OPEN_PERIOD_START,
        },
        STORED_SCHEDULE.drawAt,
      );

      expect(blocks).toEqual([]);
    });

    test('予選に勝利したがWeek優勝していない枠の無いローンチは禁止を返さない', async () => {
      const { blocks } = await findBlocks(
        {
          years: [yearRowOf()],
          champions: [championOf(2)],
          openPeriodStart: OPEN_PERIOD_START,
        },
        BEFORE_DEADLINE,
      );

      expect(blocks).toEqual([]);
    });
  });

  describe('参加資格を得た枠と勝ち残りの枠(要件13.2)', () => {
    test('参加資格を得た枠は、決済期限の後も解除の日時なしで禁止する', async () => {
      const { blocks } = await findBlocks(
        { entries: [entryOf(1, 'entitled')], years: [yearRowOf()] },
        STORED_SCHEDULE.deadlineAt,
      );

      expect(blocks).toEqual([resultPendingOf(1)]);
    });

    test('凍結済みで分類前の参加資格を得た枠は、組み合わせ決定の途中として禁止する', async () => {
      const { blocks } = await findBlocks(
        { entries: [entryOf(1, 'entitled')], years: [DRAWING_YEAR_ROW] },
        STORED_SCHEDULE.drawAt,
      );

      expect(blocks).toEqual([resultPendingOf(1)]);
    });

    test('組み合わせで勝ち残っている枠は、解除の日時なしで禁止する', async () => {
      const { blocks } = await findBlocks(
        {
          entries: [entryOf(1, 'drawn')],
          years: [yearRowOf({ status: 'in_progress' })],
          aliveRefs: [entryIdOf(1)],
        },
        AFTER_DRAW,
      );

      expect(blocks).toEqual([resultPendingOf(1)]);
    });

    test('凍結の後に組み合わせを書き終える前の組み合わせの対象の枠は、組み合わせ決定の途中として禁止する', async () => {
      const { blocks } = await findBlocks(
        { entries: [entryOf(1, 'drawn')], years: [DRAWING_YEAR_ROW] },
        STORED_SCHEDULE.drawAt,
      );

      expect(blocks).toEqual([resultPendingOf(1)]);
    });
  });

  describe('禁止を解除する枠(要件13.3)', () => {
    test.each([
      ['期限切れ', entryOf(1, 'expired', { closeReason: 'deadline' })],
      ['喪失(削除)', entryOf(1, 'forfeited', { closeReason: 'deleted' })],
      ['喪失(退会)', entryOf(1, 'forfeited', { closeReason: 'withdrawn' })],
      [
        '除外(停止)',
        entryOf(1, 'excluded', { closeReason: 'hidden_or_suspended' }),
      ],
      ['除外(上限)', entryOf(1, 'excluded', { closeReason: 'over_capacity' })],
      ['遅れの期限切れ', entryOf(1, 'expired', { closeReason: 'late_entry' })],
    ])('%sの枠は決済期限の前でも禁止を返さない', async (_label, entry) => {
      const { blocks } = await findBlocks(
        {
          entries: [entry],
          years: [yearRowOf()],
          champions: [championOf(1)],
          openPeriodStart: OPEN_PERIOD_START,
        },
        BEFORE_DEADLINE,
      );

      expect(blocks).toEqual([]);
    });

    test('敗退した枠(進行中の年で勝ち残りでない)は禁止を返さない', async () => {
      const { blocks } = await findBlocks(
        {
          entries: [entryOf(1, 'drawn')],
          years: [yearRowOf({ status: 'in_progress' })],
          aliveRefs: [],
        },
        AFTER_DRAW,
      );

      expect(blocks).toEqual([]);
    });

    test('優勝した枠(終了した年で勝ち残りでない)は禁止を返さない', async () => {
      const { blocks } = await findBlocks(
        {
          entries: [entryOf(1, 'drawn')],
          years: [
            yearRowOf({
              status: 'finished',
              outcome: 'awarded',
              championEntryId: entryIdOf(1),
              awardedAt: AFTER_DRAW,
            }),
          ],
        },
        AFTER_DRAW,
      );

      expect(blocks).toEqual([]);
    });

    test('直近のローンチが予選に勝利していない対象は読み取りもせずに禁止を返さない', async () => {
      const { blocks, reads } = await findBlocks(
        { champions: [championOf(1)] },
        BEFORE_DEADLINE,
        [
          subjectOf(1, 'lost'),
          subjectOf(2, null),
          { ...subjectOf(3), latestLaunch: null },
        ],
      );

      expect(blocks).toEqual([]);
      expect(reads).toEqual(NO_READS);
    });
  });

  test('該当する対象と該当しない対象の混ざった一覧を、枠・勝ち残り・年・Week優勝の一括の読み取り1回ずつで判定し、該当するものだけを対象の順に返す', async () => {
    const { blocks, reads } = await findBlocks(
      {
        entries: [
          entryOf(1, 'awaiting_payment'),
          entryOf(2, 'entitled'),
          entryOf(3, 'drawn'),
          entryOf(4, 'drawn'),
          entryOf(5, 'expired', { closeReason: 'deadline' }),
        ],
        years: [yearRowOf({ status: 'in_progress' })],
        aliveRefs: [entryIdOf(3)],
        champions: [championOf(7), championOf(9)],
        openPeriodStart: OPEN_PERIOD_START,
      },
      BEFORE_DEADLINE,
      [
        subjectOf(1),
        subjectOf(2),
        subjectOf(3),
        subjectOf(4),
        subjectOf(5),
        subjectOf(6, 'lost'),
        subjectOf(7),
        subjectOf(8),
      ],
    );

    expect(blocks).toEqual([
      entryPendingOf(1, STORED_SCHEDULE.deadlineAt),
      resultPendingOf(2),
      resultPendingOf(3),
      entryPendingOf(7, STORED_SCHEDULE.deadlineAt),
    ]);
    expect(reads.entryReads).toEqual([[1, 2, 3, 4, 5, 7, 8].map(launchIdOf)]);
    expect(reads.aliveReads).toEqual([
      { kind: 'year', refs: [entryIdOf(3), entryIdOf(4)] },
    ]);
    expect(reads.openPeriodReads).toEqual([BEFORE_DEADLINE]);
    expect(reads.championReads).toHaveLength(1);
    expect(reads.calendarReads).toEqual([
      { years: [2026, 2027, 2028, 2029], now: BEFORE_DEADLINE },
    ]);
  });

  test('全ての対象に枠があればWeek優勝を読まず、組み合わせの対象の枠が無ければ勝ち残りを問い合わせない', async () => {
    const { reads } = await findBlocks(
      {
        entries: [entryOf(1, 'awaiting_payment')],
        years: [yearRowOf()],
        champions: [championOf(1)],
      },
      BEFORE_DEADLINE,
    );

    expect(reads.aliveReads).toEqual([]);
    expect(reads.openPeriodReads).toEqual([]);
    expect(reads.championReads).toEqual([]);
  });
});
