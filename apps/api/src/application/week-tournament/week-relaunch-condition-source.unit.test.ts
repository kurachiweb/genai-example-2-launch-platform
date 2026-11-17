import { describe, expect, test } from 'bun:test';

import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import type { RelaunchBlock } from '../product/decision-sources.ts';
import {
  BEFORE_DEADLINE,
  createWeekDecisionFakes,
  entryIdOf,
  entryOf,
  launchIdOf,
  productIdOf,
  RULE_WINDOW,
  STORED_DEADLINE_AT,
  subjectOf,
  tournamentOf,
  WEEK_START,
  type WeekDecisionScenario,
} from './testing/week-decision-fakes.ts';
import {
  WEEK_RELAUNCH_BLOCK_MESSAGES,
  WeekRelaunchConditionSource,
} from './week-relaunch-condition-source.ts';

const AFTER_DRAW = new Date(RULE_WINDOW.drawAt.getTime() + 86_400_000);

function entryPendingOf(index: number, releaseAt: Date): RelaunchBlock {
  return {
    productId: productIdOf(index),
    code: 'tournament-week.entry-pending',
    message: WEEK_RELAUNCH_BLOCK_MESSAGES.entryPending,
    releaseAt,
  };
}

function resultPendingOf(index: number): RelaunchBlock {
  return {
    productId: productIdOf(index),
    code: 'tournament-week.result-pending',
    message: WEEK_RELAUNCH_BLOCK_MESSAGES.resultPending,
    releaseAt: null,
  };
}

async function findBlocks(
  scenario: WeekDecisionScenario,
  at: Date,
  subjects = [subjectOf(1)],
) {
  const fakes = createWeekDecisionFakes(scenario);
  const blocks = await new WeekRelaunchConditionSource(
    fakes.store,
    fakes.brackets,
  ).findBlocks({ subjects, at });
  return { blocks, reads: fakes.reads };
}

describe('WeekRelaunchConditionSource.findBlocks', () => {
  test('文言は文言規則の「再ローンチ不可(Week・参加前)」「同(Week・参加中)」の定型の部分', () => {
    expect(WEEK_RELAUNCH_BLOCK_MESSAGES).toEqual({
      entryPending:
        'このプロダクトはWeekトーナメントに参加できる期間中のため再ローンチできません。',
      resultPending:
        'このプロダクトはWeekトーナメント参加中のため再ローンチできません。',
    });
  });

  describe('受付中の枠(要件11.1)', () => {
    test('週の行の保存した決済期限の1ミリ秒前までは、その期限を解除の日時として禁止する', async () => {
      const { blocks } = await findBlocks(
        {
          entries: [entryOf(1, 'awaiting_payment')],
          tournaments: [tournamentOf()],
        },
        BEFORE_DEADLINE,
      );

      expect(blocks).toEqual([entryPendingOf(1, STORED_DEADLINE_AT)]);
    });

    test('保存した決済期限ちょうどからは禁止を返さない(要件11.3)', async () => {
      const { blocks } = await findBlocks(
        {
          entries: [entryOf(1, 'awaiting_payment')],
          tournaments: [tournamentOf()],
        },
        STORED_DEADLINE_AT,
      );

      expect(blocks).toEqual([]);
    });

    test('規則から求め直した期限を過ぎても、保存した期限の前なら禁止を返す', async () => {
      const { blocks } = await findBlocks(
        {
          entries: [entryOf(1, 'awaiting_payment')],
          tournaments: [tournamentOf()],
        },
        RULE_WINDOW.deadlineAt,
      );

      expect(blocks).toEqual([entryPendingOf(1, STORED_DEADLINE_AT)]);
    });
  });

  describe('予選の勝利の確定から枠の作成までの間(要件11.6)', () => {
    test('週の行が無ければ、ローンチ日の週の規則の決済期限の前まで禁止する', async () => {
      const before = await findBlocks(
        {},
        new Date(RULE_WINDOW.deadlineAt.getTime() - 1),
      );
      const atDeadline = await findBlocks({}, RULE_WINDOW.deadlineAt);

      expect(before.blocks).toEqual([
        entryPendingOf(1, RULE_WINDOW.deadlineAt),
      ]);
      expect(atDeadline.blocks).toEqual([]);
    });

    test('週の行があれば、他の枠のために作られた行の保存した決済期限を使う', async () => {
      const { blocks } = await findBlocks(
        { tournaments: [tournamentOf()] },
        RULE_WINDOW.deadlineAt,
      );

      expect(blocks).toEqual([entryPendingOf(1, STORED_DEADLINE_AT)]);
    });
  });

  describe('参加資格を得た枠と勝ち残りの枠(要件11.2)', () => {
    test('参加資格を得た枠は、決済期限の後も解除の日時なしで禁止する', async () => {
      const { blocks } = await findBlocks(
        {
          entries: [entryOf(1, 'entitled')],
          tournaments: [tournamentOf({ status: 'drawing' })],
        },
        AFTER_DRAW,
      );

      expect(blocks).toEqual([resultPendingOf(1)]);
    });

    test('組み合わせで勝ち残っている枠は、解除の日時なしで禁止する', async () => {
      const { blocks } = await findBlocks(
        {
          entries: [entryOf(1, 'drawn')],
          tournaments: [tournamentOf({ status: 'in_progress' })],
          aliveRefs: [entryIdOf(1)],
        },
        AFTER_DRAW,
      );

      expect(blocks).toEqual([resultPendingOf(1)]);
    });

    test('凍結の後に組み合わせを書き終える前の組み合わせの対象の枠は、組み合わせ決定を待つ間として禁止する', async () => {
      const { blocks } = await findBlocks(
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

      expect(blocks).toEqual([resultPendingOf(1)]);
    });
  });

  describe('禁止を解除する枠(要件11.3・11.4、仮1)', () => {
    test.each([
      ['期限切れ', entryOf(1, 'expired', { closeReason: 'deadline' })],
      ['喪失', entryOf(1, 'forfeited', { closeReason: 'deleted' })],
      ['除外', entryOf(1, 'excluded', { closeReason: 'hidden_or_suspended' })],
    ])('%sの枠は決済期限の前でも禁止を返さない', async (_label, entry) => {
      const { blocks } = await findBlocks(
        { entries: [entry], tournaments: [tournamentOf()] },
        BEFORE_DEADLINE,
      );

      expect(blocks).toEqual([]);
    });

    test('敗退した枠(進行中の週で勝ち残りでない)は禁止を返さない', async () => {
      const { blocks } = await findBlocks(
        {
          entries: [entryOf(1, 'drawn')],
          tournaments: [tournamentOf({ status: 'in_progress' })],
          aliveRefs: [],
        },
        AFTER_DRAW,
      );

      expect(blocks).toEqual([]);
    });

    test('優勝した枠(終了した週で勝ち残りでない)は禁止を返さず、以後の禁止をYearの条件に任せる', async () => {
      const { blocks } = await findBlocks(
        {
          entries: [entryOf(1, 'drawn')],
          tournaments: [
            tournamentOf({
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
      const { blocks, reads } = await findBlocks({}, BEFORE_DEADLINE, [
        subjectOf(1, 'lost'),
        subjectOf(2, null),
        { ...subjectOf(3), latestLaunch: null },
      ]);

      expect(blocks).toEqual([]);
      expect(reads).toEqual({ entryReads: [], weekReads: [], aliveReads: [] });
    });
  });

  test('該当する対象と該当しない対象の混ざった一覧を、枠・週・勝ち残りの一括の読み取り1回ずつで判定し、該当するものだけを対象の順に返す', async () => {
    const otherWeekLaunch = parseBusinessDate('2027-02-24');
    const { blocks, reads } = await findBlocks(
      {
        entries: [
          entryOf(1, 'awaiting_payment'),
          entryOf(2, 'drawn'),
          entryOf(3, 'expired', { closeReason: 'deadline' }),
          entryOf(4, 'drawn'),
          entryOf(6, 'entitled'),
        ],
        tournaments: [tournamentOf()],
        aliveRefs: [entryIdOf(4)],
      },
      BEFORE_DEADLINE,
      [
        subjectOf(1),
        subjectOf(2),
        subjectOf(3),
        subjectOf(4),
        subjectOf(5, 'lost'),
        subjectOf(6),
        subjectOf(7, 'won', otherWeekLaunch),
      ],
    );

    expect(blocks).toEqual([
      entryPendingOf(1, STORED_DEADLINE_AT),
      resultPendingOf(4),
      resultPendingOf(6),
    ]);
    expect(reads.entryReads).toEqual([[1, 2, 3, 4, 6, 7].map(launchIdOf)]);
    expect(reads.weekReads).toEqual([
      [WEEK_START, parseBusinessDate('2027-02-22')],
    ]);
    expect(reads.aliveReads).toEqual([
      { kind: 'week', refs: [entryIdOf(2), entryIdOf(4)] },
    ]);
  });

  test('組み合わせの対象の枠が無ければ勝ち残りを問い合わせない', async () => {
    const { reads } = await findBlocks(
      {
        entries: [entryOf(1, 'awaiting_payment')],
        tournaments: [tournamentOf()],
      },
      BEFORE_DEADLINE,
    );

    expect(reads.aliveReads).toEqual([]);
  });
});
