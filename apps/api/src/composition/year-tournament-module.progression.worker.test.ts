import { resetSync } from '@logtape/logtape';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { eveningSlot } from '../../lib/core/notifications/notification-slots.ts';
import { parseBusinessDate } from '../../lib/core/time/business-time.ts';
import {
  configureRecordingLogs,
  type LoggedObject,
} from '../../test/support/observability-recording.ts';
import {
  castVotes,
  clearTimelineTables,
  EVENING_TIME,
  instantOf,
  KICKOFF_TIME,
  readBracketRounds,
  readPublishedEvents,
  RECONCILIATION_TIME,
  scheduledRunsOf,
  setClock,
  type Timeline,
} from '../../test/support/week-tournament-timeline.ts';
import {
  bracketIdOfYear,
  createYearTimeline,
  eveningFlushesOf,
  progressDecidedYearMatch,
  readDecidedMatchIds,
  seedYearEntrants,
  slotSnapshotOf,
  YEAR_DRAW_DATE,
  YEAR_FINAL_DATE,
  YEAR_FIRST_ROUND_DATE,
  YEAR_TIMELINE_JOB_PREFIXES,
} from '../../test/support/year-tournament-timeline.ts';
import { EVENING_BRACKET_PARTICIPANT } from '../application/week-tournament/week-tournament-jobs.ts';
import { YEAR_EVENING_BRACKET_PARTICIPANT } from '../application/year-tournament/year-tournament-jobs.ts';

const SEMIFINAL_SLOT = eveningSlot(parseBusinessDate(YEAR_FIRST_ROUND_DATE));

const DEADLINE_DELAY_SECONDS = Math.ceil(
  (SEMIFINAL_SLOT.settleUntil.getTime() -
    instantOf(YEAR_FIRST_ROUND_DATE, EVENING_TIME).getTime()) /
    1000,
);

const PROGRESSION_PATHS = [
  ['確定のマッチイベントの処理', true],
  ['23:45のジョブ', false],
] as const;

let logs: LoggedObject[];

async function matchIdsOfRound(round: number): Promise<string[]> {
  return (await readBracketRounds(await bracketIdOfYear()))
    .filter((node) => node.round === round)
    .map(({ matchId }) => matchId);
}

// 参加4の年を決済期限日の23:45に組み合わせ、準決勝の日の0:00に始めて側1に票を集め、23:40に確定させる
async function playSemifinals(timeline: Timeline): Promise<string[]> {
  await seedYearEntrants(
    [1, 2, 3, 4].map((index) => ({ index, entitled: true })),
  );
  await timeline.run(YEAR_DRAW_DATE, EVENING_TIME);
  await timeline.run(YEAR_FIRST_ROUND_DATE, KICKOFF_TIME);
  const semifinals = await matchIdsOfRound(1);
  for (const matchId of semifinals) {
    await castVotes(matchId);
  }
  await timeline.run(YEAR_FIRST_ROUND_DATE, RECONCILIATION_TIME);
  return semifinals.toSorted();
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  await clearTimelineTables();
  logs = configureRecordingLogs();
});

afterEach(() => {
  vi.useRealTimers();
  resetSync();
});

describe('準決勝の確定から決勝の開始までのラウンドの進行', () => {
  test.each(PROGRESSION_PATHS)(
    '%sが決勝を予定しても、準決勝の結果と翌日の決勝の予告を準備の完了より前に発行し、翌日の0:00に決勝が1組だけ始まる',
    async (_path, byDecidedEvent) => {
      const timeline = createYearTimeline({
        inspect: slotSnapshotOf(SEMIFINAL_SLOT.key),
      });
      const semifinals = await playSemifinals(timeline);
      const decided = await readDecidedMatchIds('year');

      if (byDecidedEvent) {
        setClock(instantOf(YEAR_FIRST_ROUND_DATE, { hour: 23, minute: 41 }));
        const container = timeline.container();
        for (const matchId of decided) {
          await progressDecidedYearMatch(container, matchId);
        }
        expect(await matchIdsOfRound(2)).toHaveLength(1);
      }
      await timeline.run(YEAR_FIRST_ROUND_DATE, EVENING_TIME);
      const [final] = await matchIdsOfRound(2);
      if (final === undefined) {
        throw new Error('決勝のマッチがありません');
      }
      const semifinalPreviews = semifinals.map((matchId) => ({
        type: 'match_preview',
        subject: matchId,
      }));
      const semifinalNightEvents = [
        ...[final, ...semifinals].toSorted().map((matchId) => ({
          type: 'match_preview',
          subject: matchId,
        })),
        ...semifinals.map((matchId) => ({
          type: 'match_result',
          subject: matchId,
        })),
      ];
      await timeline.run(YEAR_FINAL_DATE, KICKOFF_TIME);

      expect(decided).toEqual(semifinals);
      expect(
        scheduledRunsOf(logs, YEAR_TIMELINE_JOB_PREFIXES).slice(-2),
      ).toEqual([
        [
          { name: 'match-engine.qualifier-pairing', result: 'succeeded' },
          { name: 'notifications.evening-dispatch', result: 'succeeded' },
          { name: 'tournament-week.evening-bracket', result: 'succeeded' },
          { name: 'tournament-year.evening-bracket', result: 'succeeded' },
        ],
        [
          { name: 'match-engine.match-kickoff', result: 'succeeded' },
          { name: 'notifications.morning-dispatch', result: 'succeeded' },
        ],
      ]);
      const flushes = eveningFlushesOf(timeline, SEMIFINAL_SLOT.key);
      expect(flushes.map(({ delaySeconds }) => delaySeconds)).toEqual([
        DEADLINE_DELAY_SECONDS,
        0,
      ]);
      expect(flushes.map(({ snapshot }) => snapshot)).toEqual([
        {
          events: byDecidedEvent ? semifinalNightEvents : semifinalPreviews,
          ready: [],
        },
        {
          events: semifinalNightEvents,
          ready: [
            EVENING_BRACKET_PARTICIPANT,
            YEAR_EVENING_BRACKET_PARTICIPANT,
          ],
        },
      ]);
      expect(
        (await readBracketRounds(await bracketIdOfYear()))
          .filter(({ round }) => round === 2)
          .map(({ matchDate, kind, status, startedAt, decidedAt }) => ({
            matchDate,
            kind,
            status,
            startedOnFinalDate:
              startedAt !== null &&
              startedAt >= instantOf(YEAR_FINAL_DATE, KICKOFF_TIME),
            decidedAt,
          })),
      ).toEqual([
        {
          matchDate: YEAR_FINAL_DATE,
          kind: 'year',
          status: 'scheduled',
          startedOnFinalDate: true,
          decidedAt: null,
        },
      ]);
      expect(await readPublishedEvents()).toEqual(semifinalNightEvents);
    },
  );
});
