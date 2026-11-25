import { describe, expect, test } from 'bun:test';

import type { MatchRecord } from '../../../lib/core/match/ports.ts';
import type { QualifierOutcome } from '../../../lib/core/product/launch-status.ts';
import {
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import type { BracketParticipantStanding } from '../../../lib/core/tournament/ports.ts';
import type { LaunchSummaryContribution } from '../product/decision-sources.ts';
import {
  DEFAULT_SCHEDULE,
  DRAWING_YEAR_ROW,
  entryIdOf,
  entryOf,
  launchIdOf,
  NO_READS,
  productIdOf,
  STORED_SCHEDULE,
  YEAR,
  yearRowOf,
} from './testing/year-decision-fakes.ts';
import {
  createYearSummaryFakes,
  standingOf,
  YEAR_BRACKET_ID,
  yearMatchOf,
  type YearSummaryScenario,
} from './testing/year-summary-fakes.ts';
import { YearLaunchSummarySource } from './year-launch-summary-source.ts';

const FIRST_ROUND_DATE: BusinessDate = parseBusinessDate('2027-06-10');
const SECOND_ROUND_DATE: BusinessDate = parseBusinessDate('2027-06-11');

const at = (date: BusinessDate, hour: number, minute = 0): Date =>
  fromBusinessDateTime(date, { hour, minute });

const DURING_FIRST_ROUND = at(FIRST_ROUND_DATE, 12);
const AFTER_FIRST_ROUND = at(FIRST_ROUND_DATE, 23, 50);
const DURING_SECOND_ROUND = at(SECOND_ROUND_DATE, 12);
const BEFORE_DEFAULT_ACCEPT_UNTIL = new Date(
  DEFAULT_SCHEDULE.acceptUntil.getTime() - 1,
);

const IN_PROGRESS = yearRowOf({
  status: 'in_progress',
  drawStartedAt: STORED_SCHEDULE.drawAt,
  bracketId: YEAR_BRACKET_ID,
});

function launchOf(index: number, outcome: QualifierOutcome | null = 'won') {
  return {
    launchId: launchIdOf(index),
    productId: productIdOf(index),
    outcome,
  };
}

function summaryOf(
  index: number,
  label: string,
  rank: number,
  inMatch = false,
): LaunchSummaryContribution {
  return { launchId: launchIdOf(index), label, inMatch, rank };
}

function drawnScenario(
  standing: BracketParticipantStanding,
  matches: readonly MatchRecord[] = [],
): YearSummaryScenario {
  return {
    entries: [entryOf(1, 'drawn')],
    years: [IN_PROGRESS],
    standings: new Map([[entryIdOf(1), standing]]),
    matches: new Map(matches.length === 0 ? [] : [[launchIdOf(1), matches]]),
  };
}

async function summarize(
  scenario: YearSummaryScenario,
  now: Date,
  launches = [launchOf(1)],
) {
  const fakes = createYearSummaryFakes(scenario);
  const result = await new YearLaunchSummarySource(
    fakes.entries,
    fakes.brackets,
    fakes.calendar,
    fakes.matches,
  ).summarize({ launches, at: now });
  return { ...result, reads: fakes.reads };
}

describe('YearLaunchSummarySource.summarize', () => {
  test('優勝した枠は「Product of the Year」(100)と、プロダクトのIDと対象年の表記だけを持つ受賞を返す', async () => {
    const { launches, awards } = await summarize(
      {
        entries: [entryOf(1, 'drawn')],
        years: [
          yearRowOf({
            status: 'finished',
            drawStartedAt: STORED_SCHEDULE.drawAt,
            bracketId: YEAR_BRACKET_ID,
            outcome: 'awarded',
            championEntryId: entryIdOf(1),
            awardedAt: AFTER_FIRST_ROUND,
          }),
        ],
        standings: new Map([
          [entryIdOf(1), standingOf(2, { status: 'finished', champion: true })],
        ]),
      },
      DURING_SECOND_ROUND,
    );

    expect(launches).toEqual([summaryOf(1, 'Product of the Year', 100)]);
    expect(awards).toEqual([
      { productId: productIdOf(1), kind: 'year', label: '2027年' },
    ]);
  });

  test('勝ち残りでその日のマッチが開催中なら「Year<ラウンド名>マッチ中」(90)を返し、トップページの導線を添える', async () => {
    const { launches, awards } = await summarize(
      drawnScenario(standingOf(4, { participantNo: 3 }), [
        yearMatchOf({
          index: 1,
          launch: 1,
          round: 1,
          date: FIRST_ROUND_DATE,
          now: DURING_FIRST_ROUND,
          started: true,
        }),
      ]),
      DURING_FIRST_ROUND,
    );

    expect(launches).toEqual([summaryOf(1, 'Year準決勝マッチ中', 90, true)]);
    expect(awards).toEqual([]);
  });

  test('2回戦以降の開催中のマッチは、ブラケットの形から求めたそのラウンドの名前を使う', async () => {
    const { launches } = await summarize(
      drawnScenario(standingOf(13, { participantNo: 2 }), [
        yearMatchOf({
          index: 2,
          launch: 1,
          round: 2,
          date: SECOND_ROUND_DATE,
          now: DURING_SECOND_ROUND,
          started: true,
        }),
      ]),
      DURING_SECOND_ROUND,
    );

    expect(launches).toEqual([summaryOf(1, 'Year準々決勝マッチ中', 90, true)]);
  });

  test('勝ち残りで直近のマッチに勝って確定したなら「Year<次のラウンド名>進出」(80)を返す', async () => {
    const { launches } = await summarize(
      drawnScenario(standingOf(8, { participantNo: 3 }), [
        yearMatchOf({
          index: 1,
          launch: 1,
          round: 1,
          date: FIRST_ROUND_DATE,
          now: AFTER_FIRST_ROUND,
          result: 'won',
        }),
      ]),
      AFTER_FIRST_ROUND,
    );

    expect(launches).toEqual([summaryOf(1, 'Year準決勝進出', 80)]);
  });

  test('1試合以上を終えて次のマッチが開始前なら、そのマッチのラウンドへの進出を返す', async () => {
    const { launches } = await summarize(
      drawnScenario(standingOf(8, { participantNo: 3 }), [
        yearMatchOf({
          index: 2,
          launch: 1,
          round: 2,
          date: SECOND_ROUND_DATE,
          now: AFTER_FIRST_ROUND,
        }),
        yearMatchOf({
          index: 1,
          launch: 1,
          round: 1,
          date: FIRST_ROUND_DATE,
          now: AFTER_FIRST_ROUND,
          result: 'won',
        }),
      ]),
      AFTER_FIRST_ROUND,
    );

    expect(launches).toEqual([summaryOf(1, 'Year準決勝進出', 80)]);
  });

  test('組み合わせに入ってまだ試合を終えていない枠は、シードかどうかや開始前のマッチの有無によらず「Yearトーナメント参加決定」(70)を返す', async () => {
    const seed = await summarize(
      drawnScenario(standingOf(13, { participantNo: 3 })),
      DURING_FIRST_ROUND,
    );
    const nonSeed = await summarize(
      drawnScenario(standingOf(6, { participantNo: 3 })),
      DURING_FIRST_ROUND,
    );
    const scheduled = await summarize(
      drawnScenario(standingOf(13, { participantNo: 10 }), [
        yearMatchOf({
          index: 1,
          launch: 1,
          round: 1,
          date: FIRST_ROUND_DATE,
          now: STORED_SCHEDULE.drawAt,
        }),
      ]),
      STORED_SCHEDULE.drawAt,
    );

    for (const { launches } of [seed, nonSeed, scheduled]) {
      expect(launches).toEqual([summaryOf(1, 'Yearトーナメント参加決定', 70)]);
    }
  });

  test('直近のYearのマッチだけを見て、Weekや予選のマッチを試合に数えない', async () => {
    const { launches } = await summarize(
      drawnScenario(standingOf(8, { participantNo: 3 }), [
        yearMatchOf({
          index: 9,
          launch: 1,
          round: 3,
          date: parseBusinessDate('2026-09-13'),
          now: DURING_FIRST_ROUND,
          result: 'won',
          kind: 'week',
        }),
      ]),
      DURING_FIRST_ROUND,
    );

    expect(launches).toEqual([summaryOf(1, 'Yearトーナメント参加決定', 70)]);
  });

  test('敗退した枠は敗退したラウンドの名前で「Year<ラウンド名>敗退」(80)を返す', async () => {
    const { launches } = await summarize(
      drawnScenario(standingOf(13, { participantNo: 2, eliminatedRound: 2 })),
      DURING_SECOND_ROUND,
    );

    expect(launches).toEqual([summaryOf(1, 'Year準々決勝敗退', 80)]);
  });

  test('負けが確定し、ブラケットへの敗退の記録の前でも、そのラウンドの敗退を返す', async () => {
    const { launches } = await summarize(
      drawnScenario(standingOf(4, { participantNo: 3 }), [
        yearMatchOf({
          index: 1,
          launch: 1,
          round: 1,
          date: FIRST_ROUND_DATE,
          now: AFTER_FIRST_ROUND,
          result: 'lost',
        }),
      ]),
      AFTER_FIRST_ROUND,
    );

    expect(launches).toEqual([summaryOf(1, 'Year準決勝敗退', 80)]);
  });

  test('参加資格を得た枠と、組み合わせを書き終える前の組み合わせの対象の枠は「Yearトーナメント参加決定」(70)を返す', async () => {
    const { launches, reads } = await summarize(
      {
        entries: [entryOf(1, 'entitled'), entryOf(2, 'drawn')],
        years: [DRAWING_YEAR_ROW],
      },
      STORED_SCHEDULE.drawAt,
      [launchOf(1), launchOf(2)],
    );

    expect(launches).toEqual([
      summaryOf(1, 'Yearトーナメント参加決定', 70),
      summaryOf(2, 'Yearトーナメント参加決定', 70),
    ]);
    expect(reads.standingReads).toEqual([
      { kind: 'year', refs: [entryIdOf(2)] },
    ]);
  });

  test('受付中の枠は、Week優勝の日から求めた対象年の受付期限より前だけ「Yearトーナメント参加受付中」(60)を返す', async () => {
    const scenario = { entries: [entryOf(1, 'awaiting_payment')] };

    const before = await summarize(scenario, BEFORE_DEFAULT_ACCEPT_UNTIL);
    const atAcceptUntil = await summarize(
      scenario,
      DEFAULT_SCHEDULE.acceptUntil,
    );

    expect(before.launches).toEqual([
      summaryOf(1, 'Yearトーナメント参加受付中', 60),
    ]);
    expect(atAcceptUntil.launches).toEqual([]);
  });

  test('年の行があれば保存した受付期限で判定する', async () => {
    const scenario = {
      entries: [entryOf(1, 'awaiting_payment')],
      years: [yearRowOf()],
    };

    const atDefault = await summarize(scenario, DEFAULT_SCHEDULE.acceptUntil);
    const atStored = await summarize(scenario, STORED_SCHEDULE.acceptUntil);

    expect(atDefault.launches).toEqual([
      summaryOf(1, 'Yearトーナメント参加受付中', 60),
    ]);
    expect(atStored.launches).toEqual([]);
  });

  test('対象年が凍結済み(遅れ)の受付中の枠には何も返さない', async () => {
    const { launches } = await summarize(
      { entries: [entryOf(1, 'awaiting_payment')], years: [DRAWING_YEAR_ROW] },
      STORED_SCHEDULE.drawAt,
    );

    expect(launches).toEqual([]);
  });

  test('期限切れ・喪失・除外の枠、枠の無いローンチ、予選で勝っていないローンチ、年の行への記録前の優勝には何も返さない', async () => {
    const { launches, awards } = await summarize(
      {
        entries: [
          entryOf(1, 'expired'),
          entryOf(2, 'forfeited'),
          entryOf(3, 'excluded'),
          entryOf(6, 'drawn'),
        ],
        years: [IN_PROGRESS],
        standings: new Map([
          [entryIdOf(6), standingOf(2, { status: 'finished', champion: true })],
        ]),
      },
      BEFORE_DEFAULT_ACCEPT_UNTIL,
      [
        launchOf(1),
        launchOf(2),
        launchOf(3),
        launchOf(4),
        launchOf(5, 'lost'),
        launchOf(6),
      ],
    );

    expect(launches).toEqual([]);
    expect(awards).toEqual([]);
  });

  test('対象の数によらず、枠・年の日程・参加者の状態・マッチをそれぞれ1回の一括で読む', async () => {
    const { launches, reads } = await summarize(
      {
        entries: [
          entryOf(1, 'drawn'),
          entryOf(2, 'drawn'),
          entryOf(3, 'entitled'),
          entryOf(4, 'awaiting_payment'),
          entryOf(7, 'drawn', { classifiedYear: YEAR - 1 }),
        ],
        years: [IN_PROGRESS],
        standings: new Map([
          [entryIdOf(1), standingOf(4, { participantNo: 1 })],
          [entryIdOf(2), standingOf(4, { eliminatedRound: 1 })],
          [entryIdOf(7), standingOf(4, { eliminatedRound: 2 })],
        ]),
      },
      DURING_FIRST_ROUND,
      [
        launchOf(1),
        launchOf(2),
        launchOf(3),
        launchOf(4),
        launchOf(5, null),
        launchOf(7),
      ],
    );

    expect(launches).toEqual([
      summaryOf(1, 'Yearトーナメント参加決定', 70),
      summaryOf(2, 'Year準決勝敗退', 80),
      summaryOf(3, 'Yearトーナメント参加決定', 70),
      summaryOf(7, 'Year決勝敗退', 80),
    ]);
    expect(reads.entryReads).toEqual([[1, 2, 3, 4, 7].map(launchIdOf)]);
    expect(reads.calendarReads).toEqual([
      { years: [2026, 2027, 2028, 2029], now: DURING_FIRST_ROUND },
    ]);
    expect(reads.standingReads).toEqual([
      { kind: 'year', refs: [1, 2, 7].map(entryIdOf) },
    ]);
    expect(reads.matchReads).toEqual([
      { launchIds: [1, 2, 7].map(launchIdOf), now: DURING_FIRST_ROUND },
    ]);
    expect(reads.aliveReads).toEqual([]);
    expect(reads.openPeriodReads).toEqual([]);
    expect(reads.championReads).toEqual([]);
  });

  test('予選で勝ったローンチが無ければ何も読まず、組み合わせの対象の枠が無ければ参加者の状態とマッチを読まない', async () => {
    const none = await summarize({}, BEFORE_DEFAULT_ACCEPT_UNTIL, [
      launchOf(1, 'lost'),
      launchOf(2, null),
    ]);
    const undrawn = await summarize(
      { entries: [entryOf(1, 'entitled')] },
      BEFORE_DEFAULT_ACCEPT_UNTIL,
    );

    expect(none).toMatchObject({ launches: [], awards: [] });
    expect(none.reads).toEqual({
      ...NO_READS,
      standingReads: [],
      matchReads: [],
    });
    expect(undrawn.reads.calendarReads).toEqual([]);
    expect(undrawn.reads.standingReads).toEqual([]);
    expect(undrawn.reads.matchReads).toEqual([]);
  });
});
