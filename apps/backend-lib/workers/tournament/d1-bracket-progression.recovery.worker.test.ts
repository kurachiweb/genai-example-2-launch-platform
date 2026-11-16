import type { Event } from '@sentry/cloudflare';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import type { LogObject } from '../../core/logging/log-record.ts';
import { createUlidGenerator } from '../../core/ids/id-generator.ts';
import { systemClock } from '../../core/time/clock.ts';
import type { MatchScheduler } from '../../core/match/ports.ts';
import { D1MatchDirectory } from '../match/d1-match-directory.ts';
import { D1MatchScheduler } from '../match/d1-match-scheduler.ts';
import {
  createRecordingDispatcher,
  createSequentialIds,
} from '../match/testing/event-fixtures.ts';
import {
  db,
  insertUser,
  launchIdOf,
  productIdOf,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import {
  bracketMatchIdOf,
  clearBracketTables,
} from './testing/bracket-fixtures.ts';
import { D1BracketProgression } from './d1-bracket-progression.ts';
import { D1BracketStore } from './d1-bracket-store.ts';
import {
  installRecordingSentry,
  recordLogs,
  resetObservability,
} from './testing/observability-fixtures.ts';
import {
  AFTER_MIDNIGHT,
  BRACKET_ID,
  createProgression,
  DRAW_AT,
  FIRST_ROUND_ADVANCE_AT,
  FIRST_ROUND_DATE,
  FIRST_ROUND_IDS,
  insertPlannedRound,
  LATE_SECOND_ROUND_DATE,
  POLICY,
  PROGRESSION_CATEGORY,
  R1_POSITION_1,
  R1_POSITION_2,
  readBracketMatches,
  readMatchesOfRound,
  readScheduledEventMatchIds,
  scheduleFirstRoundOfSix,
  scheduleInputOf,
  SECOND_ROUND_DATE,
  seedBracket,
  settle,
  windowOf,
} from './testing/progression-fixtures.ts';

let logs: LogObject[] = [];
let events: Event[] = [];

function progressionLogs(): LogObject[] {
  return logs.filter(({ category }) => category === PROGRESSION_CATEGORY);
}

function lateEvents(): Event[] {
  return events.filter(
    (event) => event.tags?.tournament_incident === 'round-late',
  );
}

beforeEach(async () => {
  logs = recordLogs();
  events = installRecordingSentry();
  await clearBracketTables();
  await insertUser(1);
});

afterEach(resetObservability);

describe('D1BracketProgression.advance(中断からの再開)', () => {
  test('予定の作成の前に中断した1回戦の位置は、記録済みのマッチIDのまま予定を作り予定済みにする', async () => {
    await seedBracket(6);
    await insertPlannedRound(1, FIRST_ROUND_DATE, [
      { index: 1, position: 1, participantNos: [3, 4] },
      { index: 2, position: 2, participantNos: [5, 6] },
    ]);
    const plannedIds = [bracketMatchIdOf(1), bracketMatchIdOf(2)];

    const result = await createProgression(FIRST_ROUND_IDS).progression.advance(
      BRACKET_ID,
      POLICY,
      DRAW_AT,
    );

    expect(result).toEqual({
      kind: 'scheduled',
      bracketId: BRACKET_ID,
      round: 1,
      late: false,
      decidedMatchIds: [],
      previewMatchIds: plannedIds,
    });
    expect(await readBracketMatches()).toEqual(
      plannedIds.map((matchId): unknown =>
        expect.objectContaining({
          matchId,
          matchDate: FIRST_ROUND_DATE,
          status: 'scheduled',
        }),
      ),
    );
    expect(await readMatchesOfRound(1)).toEqual(
      plannedIds.map((id): unknown =>
        expect.objectContaining({ id, matchDate: FIRST_ROUND_DATE }),
      ),
    );
    expect(progressionLogs()).toEqual([]);
    expect(lateEvents()).toEqual([]);
  });

  describe('0:00を過ぎてからの2回戦の再開', () => {
    const plannedIds = [bracketMatchIdOf(11), bracketMatchIdOf(12)];

    beforeEach(async () => {
      await scheduleFirstRoundOfSix();
      await settle(R1_POSITION_1, ['won', 'lost']);
      await settle(R1_POSITION_2, ['lost', 'won']);
      await insertPlannedRound(2, SECOND_ROUND_DATE, [
        { index: 11, position: 1, participantNos: [1, 6] },
        { index: 12, position: 2, participantNos: [2, 3] },
      ]);
    });

    test('実施日を方針の次の日に改めて予定を作り、遅れとして返す', async () => {
      const result = await createProgression(101).progression.advance(
        BRACKET_ID,
        POLICY,
        AFTER_MIDNIGHT,
      );

      expect(result).toEqual({
        kind: 'scheduled',
        bracketId: BRACKET_ID,
        round: 2,
        late: true,
        decidedMatchIds: [R1_POSITION_1, R1_POSITION_2],
        previewMatchIds: plannedIds,
      });
      expect(await readBracketMatches(2)).toEqual(
        plannedIds.map((matchId): unknown =>
          expect.objectContaining({
            matchId,
            matchDate: LATE_SECOND_ROUND_DATE,
            status: 'scheduled',
          }),
        ),
      );
      const window = windowOf(LATE_SECOND_ROUND_DATE);
      expect(await readMatchesOfRound(2)).toEqual(
        plannedIds.map((id): unknown =>
          expect.objectContaining({
            id,
            matchDate: LATE_SECOND_ROUND_DATE,
            startsAt: window.startsAt,
          }),
        ),
      );
    });

    test('遅れをブラケットとマッチの識別だけのwarnのログとエラートラッキングへの1件の通知で知らせ、2回目の呼び出しでは知らせない', async () => {
      await createProgression(101).progression.advance(
        BRACKET_ID,
        POLICY,
        AFTER_MIDNIGHT,
      );
      await createProgression(201).progression.advance(
        BRACKET_ID,
        POLICY,
        AFTER_MIDNIGHT,
      );

      const [log, ...otherLogs] = progressionLogs();
      expect(otherLogs).toEqual([]);
      expect(log?.level).toBe('warning');
      expect(Object.keys(log ?? {}).sort()).toEqual([
        'bracketId',
        'category',
        'level',
        'matchIds',
        'message',
        'time',
      ]);
      expect(log).toMatchObject({
        bracketId: BRACKET_ID,
        matchIds: plannedIds,
      });
      const [event, ...otherEvents] = lateEvents();
      expect(otherEvents).toEqual([]);
      expect(event?.level).toBe('warning');
      expect(event?.logentry?.message).toBe(log?.message);
      expect(event?.message).toBeUndefined();
      expect(event?.fingerprint).toEqual(['tournament', 'round-late']);
      expect(event?.tags).toStrictEqual({
        tournament_incident: 'round-late',
        bracket_id: BRACKET_ID,
      });
      const recorded = JSON.stringify([logs, events]);
      for (const value of [launchIdOf(1), productIdOf(1), userIdOf(1)]) {
        expect(recorded).not.toContain(value);
      }
    });

    test('予定を作った後で記録の前に中断した位置は、作り直さずにそのマッチの実施日のまま予定済みにする', async () => {
      await new D1MatchScheduler(
        db,
        createRecordingDispatcher(),
        createUlidGenerator(systemClock),
      ).schedule(
        [scheduleInputOf(bracketMatchIdOf(11), 2, SECOND_ROUND_DATE, [1, 6])],
        FIRST_ROUND_ADVANCE_AT,
      );

      const result = await createProgression(101).progression.advance(
        BRACKET_ID,
        POLICY,
        AFTER_MIDNIGHT,
      );

      expect(result).toMatchObject({
        kind: 'scheduled',
        round: 2,
        late: true,
        previewMatchIds: plannedIds,
      });
      expect(await readBracketMatches(2)).toEqual([
        expect.objectContaining({
          matchId: bracketMatchIdOf(11),
          matchDate: SECOND_ROUND_DATE,
          status: 'scheduled',
        }),
        expect.objectContaining({
          matchId: bracketMatchIdOf(12),
          matchDate: LATE_SECOND_ROUND_DATE,
          status: 'scheduled',
        }),
      ]);
      expect(await readScheduledEventMatchIds()).toEqual(
        [R1_POSITION_1, R1_POSITION_2, ...plannedIds].sort(),
      );
      expect(progressionLogs()).toEqual([
        expect.objectContaining({ matchIds: [bracketMatchIdOf(12)] }),
      ]);
    });

    test('予定の作成の間に別の呼び出しが先にマッチを作っていれば、そのマッチの実施日に記録をそろえ、遅れとして知らせない', async () => {
      const inner = new D1MatchScheduler(
        db,
        createRecordingDispatcher(),
        createUlidGenerator(systemClock),
      );
      const racing: MatchScheduler = {
        async schedule(inputs, scheduledAt) {
          await inner.schedule(
            inputs.map((input) =>
              scheduleInputOf(
                input.matchId,
                2,
                SECOND_ROUND_DATE,
                input.matchId === bracketMatchIdOf(11) ? [1, 6] : [2, 3],
              ),
            ),
            FIRST_ROUND_ADVANCE_AT,
          );
          return inner.schedule(inputs, scheduledAt);
        },
      };
      const progression = new D1BracketProgression(
        db,
        createSequentialIds(101),
        new D1BracketStore(db),
        new D1MatchDirectory(db),
        racing,
        'api',
      );

      await progression.advance(BRACKET_ID, POLICY, AFTER_MIDNIGHT);

      expect(await readBracketMatches(2)).toEqual(
        plannedIds.map((matchId): unknown =>
          expect.objectContaining({
            matchId,
            matchDate: SECOND_ROUND_DATE,
            status: 'scheduled',
          }),
        ),
      );
      expect(progressionLogs()).toEqual([]);
      expect(lateEvents()).toEqual([]);
    });
  });
});
