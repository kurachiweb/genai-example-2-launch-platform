import { resetSync } from '@logtape/logtape';
import { ContainerModule } from 'inversify';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { NOTIFICATIONS_PLATFORM_TYPES } from '../../lib/core/notifications/identifiers.ts';
import type { NotificationEventPublisher } from '../../lib/core/notifications/notification-event-contract.ts';
import { eveningSlot } from '../../lib/core/notifications/notification-slots.ts';
import { parseBusinessDate } from '../../lib/core/time/business-time.ts';
import { readSlotRow } from '../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import {
  configureRecordingLogs,
  type LoggedObject,
} from '../../test/support/observability-recording.ts';
import {
  castVotes,
  clearTimelineTables,
  createTimeline,
  DRAW_DATE,
  EVENING_TIME,
  FIRST_ROUND_DATE,
  instantOf,
  KICKOFF_TIME,
  progressDecidedWeekMatch,
  readBracketRounds,
  readDecidedWeekMatchIds,
  readPublishedEvents,
  readReadyParticipants,
  readWeekTournament,
  RECONCILIATION_TIME,
  scheduledRunsOf,
  SECOND_ROUND_DATE,
  seedWeekEntrants,
  setClock,
  type Timeline,
} from '../../test/support/week-tournament-timeline.ts';

const NOT_PREVIEWABLE_MESSAGE =
  '開始済みのマッチの予告を通知イベントの発行から除きました';

const FIRST_ROUND_SLOT = eveningSlot(parseBusinessDate(FIRST_ROUND_DATE));

const PROGRESSION_PATHS = [
  ['確定のマッチイベントの処理', true],
  ['23:45のジョブ', false],
] as const;

let logs: LoggedObject[];

async function bracketIdOfWeek(): Promise<string> {
  const bracketId = (await readWeekTournament())?.bracketId;
  if (bracketId == null) {
    throw new Error('週のトーナメントにブラケットがありません');
  }
  return bracketId;
}

async function matchIdsOfRound(round: number): Promise<string[]> {
  return (await readBracketRounds(await bracketIdOfWeek()))
    .filter((node) => node.round === round)
    .map(({ matchId }) => matchId);
}

// 参加4の週を月曜日の23:45に組み合わせ、火曜日の0:00に準決勝を始めて側1に票を集め、23:40に確定させる
async function playSemifinals(timeline: Timeline): Promise<string[]> {
  await seedWeekEntrants(
    [1, 2, 3, 4].map((index) => ({ index, entitled: true })),
  );
  await timeline.run(DRAW_DATE, EVENING_TIME);
  await timeline.run(FIRST_ROUND_DATE, KICKOFF_TIME);
  const semifinals = await matchIdsOfRound(1);
  for (const matchId of semifinals) {
    await castVotes(matchId);
  }
  await timeline.run(FIRST_ROUND_DATE, RECONCILIATION_TIME);
  return semifinals;
}

// 通知の機能の発行の口が一時的に失敗する起動を作る
const failingNotificationEvents = {
  bindings: new ContainerModule(({ rebind }) => {
    rebind<NotificationEventPublisher>(
      NOTIFICATIONS_PLATFORM_TYPES.NotificationEventPublisher,
    ).toConstantValue({
      publish: () =>
        Promise.reject(new Error('通知イベントの記録の一時的な失敗')),
    });
  }),
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  await clearTimelineTables();
  logs = configureRecordingLogs();
});

afterEach(() => {
  vi.useRealTimers();
  resetSync();
});

describe('確定から翌日の開始までのラウンドの進行', () => {
  test.each(PROGRESSION_PATHS)(
    '%sが次ラウンドを予定しても、翌日の0:00に決勝が1組だけ始まる',
    async (_path, byDecidedEvent) => {
      const timeline = createTimeline();
      const semifinals = await playSemifinals(timeline);
      const decided = await readDecidedWeekMatchIds();

      if (byDecidedEvent) {
        setClock(instantOf(FIRST_ROUND_DATE, { hour: 23, minute: 41 }));
        const container = timeline.container();
        for (const matchId of decided) {
          await progressDecidedWeekMatch(container, matchId);
        }
        expect(await matchIdsOfRound(2)).toHaveLength(1);
      }
      await timeline.run(FIRST_ROUND_DATE, EVENING_TIME);
      await timeline.run(SECOND_ROUND_DATE, KICKOFF_TIME);

      const [final] = await matchIdsOfRound(2);
      expect(decided).toEqual(semifinals.toSorted());
      expect(scheduledRunsOf(logs).slice(-2)).toEqual([
        [
          { name: 'match-engine.qualifier-pairing', result: 'succeeded' },
          { name: 'notifications.evening-dispatch', result: 'succeeded' },
          { name: 'tournament-week.evening-bracket', result: 'succeeded' },
        ],
        [
          { name: 'match-engine.match-kickoff', result: 'succeeded' },
          { name: 'notifications.morning-dispatch', result: 'succeeded' },
        ],
      ]);
      expect(
        (await readBracketRounds(await bracketIdOfWeek())).filter(
          ({ round }) => round === 2,
        ),
      ).toEqual([
        expect.objectContaining({
          matchDate: SECOND_ROUND_DATE,
          status: 'scheduled',
          startedAt: instantOf(SECOND_ROUND_DATE, KICKOFF_TIME),
          decidedAt: null,
        }),
      ]);
      expect(await readPublishedEvents()).toEqual([
        ...[final, ...semifinals].toSorted().map((matchId) => ({
          type: 'match_preview',
          subject: matchId,
        })),
        ...semifinals.toSorted().map((matchId) => ({
          type: 'match_result',
          subject: matchId,
        })),
      ]);
      expect(await readReadyParticipants(FIRST_ROUND_SLOT.key)).toEqual([
        'tournament-week.evening-bracket',
      ]);
    },
  );
});

describe('通知の機能の実際の発行の口への発行', () => {
  test('夜の発行が失敗した後、開始の後に届いた確定の処理は開始済みの決勝の予告だけを除いて準決勝の結果を記録する', async () => {
    const timeline = createTimeline();
    const semifinals = (await playSemifinals(timeline)).toSorted();
    const previewsOfMonday = semifinals.map((matchId) => ({
      type: 'match_preview',
      subject: matchId,
    }));
    expect(await readPublishedEvents()).toEqual(previewsOfMonday);

    await timeline.run(FIRST_ROUND_DATE, EVENING_TIME, [
      failingNotificationEvents,
    ]);

    const [final] = await matchIdsOfRound(2);
    expect(scheduledRunsOf(logs).at(-1)).toEqual([
      { name: 'match-engine.qualifier-pairing', result: 'succeeded' },
      { name: 'notifications.evening-dispatch', result: 'succeeded' },
      { name: 'tournament-week.evening-bracket', result: 'failed' },
    ]);
    expect(await readReadyParticipants(FIRST_ROUND_SLOT.key)).toEqual([]);
    expect(await readSlotRow(FIRST_ROUND_SLOT.key)).toMatchObject({
      dispatchRequestedAt: null,
    });
    expect(await readPublishedEvents()).toEqual(previewsOfMonday);

    await timeline.run(SECOND_ROUND_DATE, KICKOFF_TIME);
    setClock(instantOf(SECOND_ROUND_DATE, { hour: 0, minute: 5 }));
    const [decided] = await readDecidedWeekMatchIds();
    if (decided === undefined || final === undefined) {
      throw new Error('確定した準決勝か決勝がありません');
    }
    await progressDecidedWeekMatch(timeline.container(), decided);

    expect(await readPublishedEvents()).toEqual([
      ...previewsOfMonday,
      ...semifinals.map((matchId) => ({
        type: 'match_result',
        subject: matchId,
      })),
    ]);
    expect(
      logs.filter(({ message }) => message === NOT_PREVIEWABLE_MESSAGE),
    ).toEqual([
      expect.objectContaining({
        level: 'info',
        matchId: final,
        reason: 'match-not-previewable',
      }),
    ]);
  });
});
