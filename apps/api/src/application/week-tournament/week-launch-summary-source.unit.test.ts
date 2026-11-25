import { describe, expect, test } from 'bun:test';

import type { QualifierOutcome } from '../../../lib/core/product/launch-status.ts';
import {
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import type { BracketParticipantStanding } from '../../../lib/core/tournament/ports.ts';
import type { MatchRecord } from '../../../lib/core/match/ports.ts';
import type { LaunchSummaryContribution } from '../product/decision-sources.ts';
import {
  entryIdOf,
  entryOf,
  launchIdOf,
  productIdOf,
  RULE_WINDOW,
  tournamentOf,
  WEEK_START,
} from './testing/week-decision-fakes.ts';
import {
  createWeekSummaryFakes,
  standingOf,
  weekMatchOf,
  type WeekSummaryScenario,
} from './testing/week-summary-fakes.ts';
import { WeekLaunchSummarySource } from './week-launch-summary-source.ts';

const FIRST_ROUND_DATE: BusinessDate = parseBusinessDate('2027-03-09');
const SECOND_ROUND_DATE: BusinessDate = parseBusinessDate('2027-03-10');

const at = (date: BusinessDate, hour: number, minute = 0): Date =>
  fromBusinessDateTime(date, { hour, minute });

const DURING_FIRST_ROUND = at(FIRST_ROUND_DATE, 12);
const AFTER_FIRST_ROUND = at(FIRST_ROUND_DATE, 23, 50);
const DURING_SECOND_ROUND = at(SECOND_ROUND_DATE, 12);
const BEFORE_ACCEPT_UNTIL = new Date(RULE_WINDOW.acceptUntil.getTime() - 1);

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

const IN_PROGRESS = tournamentOf({
  status: 'in_progress',
  bracketId: '01JF0WBRKT0000000000000001',
});

function drawnScenario(
  standing: BracketParticipantStanding,
  matches: readonly MatchRecord[] = [],
): WeekSummaryScenario {
  return {
    entries: [entryOf(1, 'drawn')],
    tournaments: [IN_PROGRESS],
    standings: new Map([[entryIdOf(1), standing]]),
    matches: new Map(matches.length === 0 ? [] : [[launchIdOf(1), matches]]),
  };
}

async function summarize(
  scenario: WeekSummaryScenario,
  now: Date,
  launches = [launchOf(1)],
) {
  const fakes = createWeekSummaryFakes(scenario);
  const result = await new WeekLaunchSummarySource(
    fakes.store,
    fakes.brackets,
    fakes.matches,
  ).summarize({ launches, at: now });
  return { ...result, reads: fakes.reads };
}

describe('WeekLaunchSummarySource.summarize', () => {
  test('優勝した枠は「Product of the Week」(50)と、プロダクトの識別と週の期間の表記だけを持つ受賞を返す', async () => {
    const { launches, awards } = await summarize(
      {
        entries: [entryOf(1, 'drawn')],
        tournaments: [
          tournamentOf({
            status: 'finished',
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

    expect(launches).toEqual([summaryOf(1, 'Product of the Week', 50)]);
    expect(awards).toEqual([
      {
        productId: productIdOf(1),
        kind: 'week',
        label: '2027年第9週(3/1〜3/7)',
      },
    ]);
  });

  test('勝ち残りでその日のマッチが開催中なら「Week<ラウンド名>マッチ中」(40)を返し、トップページの導線を添える', async () => {
    const { launches, awards } = await summarize(
      drawnScenario(standingOf(4, { participantNo: 3 }), [
        weekMatchOf({
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

    expect(launches).toEqual([summaryOf(1, 'Week準決勝マッチ中', 40, true)]);
    expect(awards).toEqual([]);
  });

  test('2回戦以降の開催中のマッチは、ブラケットの形から求めたそのラウンドの名前を使う', async () => {
    const { launches } = await summarize(
      drawnScenario(standingOf(13, { participantNo: 2 }), [
        weekMatchOf({
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

    expect(launches).toEqual([summaryOf(1, 'Week準々決勝マッチ中', 40, true)]);
  });

  test('勝ち残りで直近のマッチに勝って確定したなら「Week<次のラウンド名>進出」(30)を返す', async () => {
    const { launches } = await summarize(
      drawnScenario(standingOf(8, { participantNo: 3 }), [
        weekMatchOf({
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

    expect(launches).toEqual([summaryOf(1, 'Week準決勝進出', 30)]);
  });

  test('勝ち残りで開始前のマッチがあれば、そのマッチのラウンドへの進出を返す', async () => {
    const { launches } = await summarize(
      drawnScenario(standingOf(13, { participantNo: 10 }), [
        weekMatchOf({
          index: 1,
          launch: 1,
          round: 1,
          date: FIRST_ROUND_DATE,
          now: RULE_WINDOW.drawAt,
        }),
      ]),
      RULE_WINDOW.drawAt,
    );

    expect(launches).toEqual([summaryOf(1, 'Week1回戦進出', 30)]);
  });

  test('マッチがまだ無いシードは2回戦への進出、シードでない参加者は1回戦への進出を返す', async () => {
    const seed = await summarize(
      drawnScenario(standingOf(13, { participantNo: 3 })),
      DURING_FIRST_ROUND,
    );
    const nonSeed = await summarize(
      drawnScenario(standingOf(6, { participantNo: 3 })),
      DURING_FIRST_ROUND,
    );

    expect(seed.launches).toEqual([summaryOf(1, 'Week準々決勝進出', 30)]);
    expect(nonSeed.launches).toEqual([summaryOf(1, 'Week1回戦進出', 30)]);
  });

  test('敗退した枠は敗退したラウンドの名前で「Week<ラウンド名>敗退」(30)を返す', async () => {
    const { launches } = await summarize(
      drawnScenario(standingOf(13, { participantNo: 2, eliminatedRound: 2 })),
      DURING_SECOND_ROUND,
    );

    expect(launches).toEqual([summaryOf(1, 'Week準々決勝敗退', 30)]);
  });

  test('負けが確定し、ブラケットへの敗退の記録の前でも、そのラウンドの敗退を返す', async () => {
    const { launches } = await summarize(
      drawnScenario(standingOf(4, { participantNo: 3 }), [
        weekMatchOf({
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

    expect(launches).toEqual([summaryOf(1, 'Week準決勝敗退', 30)]);
  });

  test('参加資格を得た枠と、組み合わせを書き終える前の組み合わせの対象の枠は「Weekトーナメント参加決定」(20)を返す', async () => {
    const { launches, reads } = await summarize(
      {
        entries: [entryOf(1, 'entitled'), entryOf(2, 'drawn')],
        tournaments: [tournamentOf({ status: 'drawing' })],
      },
      RULE_WINDOW.drawAt,
      [launchOf(1), launchOf(2)],
    );

    expect(launches).toEqual([
      summaryOf(1, 'Weekトーナメント参加決定', 20),
      summaryOf(2, 'Weekトーナメント参加決定', 20),
    ]);
    expect(reads.standingReads).toEqual([
      { kind: 'week', refs: [entryIdOf(2)] },
    ]);
  });

  test('受付中の枠は受付期限より前だけ「Weekトーナメント参加受付中」(10)を返す', async () => {
    const scenario = { entries: [entryOf(1, 'awaiting_payment')] };

    const before = await summarize(scenario, BEFORE_ACCEPT_UNTIL);
    const atAcceptUntil = await summarize(scenario, RULE_WINDOW.acceptUntil);

    expect(before.launches).toEqual([
      summaryOf(1, 'Weekトーナメント参加受付中', 10),
    ]);
    expect(atAcceptUntil.launches).toEqual([]);
  });

  test('週の行があれば保存した受付期限で判定する', async () => {
    const storedAcceptUntil = new Date(
      RULE_WINDOW.acceptUntil.getTime() + 3_600_000,
    );
    const { launches } = await summarize(
      {
        entries: [entryOf(1, 'awaiting_payment')],
        tournaments: [
          tournamentOf({
            window: { ...RULE_WINDOW, acceptUntil: storedAcceptUntil },
          }),
        ],
      },
      RULE_WINDOW.acceptUntil,
    );

    expect(launches).toEqual([summaryOf(1, 'Weekトーナメント参加受付中', 10)]);
  });

  test('期限切れ・喪失・除外の枠、枠の無いローンチ、予選で勝っていないローンチ、記録前の優勝には何も返さない', async () => {
    const { launches, awards } = await summarize(
      {
        entries: [
          entryOf(1, 'expired'),
          entryOf(2, 'forfeited'),
          entryOf(3, 'excluded'),
          entryOf(6, 'drawn'),
        ],
        tournaments: [IN_PROGRESS],
        standings: new Map([
          [entryIdOf(6), standingOf(2, { status: 'finished', champion: true })],
        ]),
      },
      BEFORE_ACCEPT_UNTIL,
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

  test('対象の数によらず、枠・週の行・参加者の状態・マッチをそれぞれ1回の一括で読む', async () => {
    const { launches, reads } = await summarize(
      {
        entries: [
          entryOf(1, 'drawn'),
          entryOf(2, 'drawn'),
          entryOf(3, 'entitled'),
          entryOf(4, 'drawn', {
            launchDate: parseBusinessDate('2027-02-24'),
            tournamentId: '01JF0WTRNM0000000000000002',
          }),
        ],
        tournaments: [IN_PROGRESS],
        standings: new Map([
          [entryIdOf(1), standingOf(4, { participantNo: 1 })],
          [entryIdOf(2), standingOf(4, { eliminatedRound: 1 })],
          [entryIdOf(4), standingOf(4, { eliminatedRound: 2 })],
        ]),
      },
      DURING_FIRST_ROUND,
      [launchOf(1), launchOf(2), launchOf(3), launchOf(4), launchOf(5, null)],
    );

    expect(launches).toEqual([
      summaryOf(1, 'Week準決勝進出', 30),
      summaryOf(2, 'Week準決勝敗退', 30),
      summaryOf(3, 'Weekトーナメント参加決定', 20),
      summaryOf(4, 'Week決勝敗退', 30),
    ]);
    expect(reads.entryReads).toEqual([[1, 2, 3, 4].map(launchIdOf)]);
    expect(reads.weekReads).toEqual([
      [WEEK_START, parseBusinessDate('2027-02-22')],
    ]);
    expect(reads.standingReads).toEqual([
      { kind: 'week', refs: [1, 2, 4].map(entryIdOf) },
    ]);
    expect(reads.matchReads).toEqual([
      { launchIds: [1, 2, 4].map(launchIdOf), now: DURING_FIRST_ROUND },
    ]);
    expect(reads.aliveReads).toEqual([]);
  });

  test('予選で勝ったローンチが無ければ何も読まず、組み合わせの対象の枠が無ければ参加者の状態とマッチを読まない', async () => {
    const none = await summarize({}, BEFORE_ACCEPT_UNTIL, [
      launchOf(1, 'lost'),
      launchOf(2, null),
    ]);
    const undrawn = await summarize(
      { entries: [entryOf(1, 'awaiting_payment')] },
      BEFORE_ACCEPT_UNTIL,
    );

    expect(none).toMatchObject({ launches: [], awards: [] });
    expect(none.reads).toMatchObject({
      entryReads: [],
      weekReads: [],
      standingReads: [],
      matchReads: [],
    });
    expect(undrawn.reads.standingReads).toEqual([]);
    expect(undrawn.reads.matchReads).toEqual([]);
  });
});
