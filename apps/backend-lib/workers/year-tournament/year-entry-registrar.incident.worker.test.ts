import type { Event } from '@sentry/cloudflare';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import type { LogObject } from '../../core/logging/log-record.ts';
import { matchIdOf } from '../match/testing/match-fixtures.ts';
import {
  launchIdOf,
  productIdOf,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import {
  installRecordingSentry,
  recordLogs,
  resetObservability,
} from '../tournament/testing/observability-fixtures.ts';
import {
  CHAMPION_1,
  CHAMPION_2,
  CHAMPION_3,
  createRegistrarHarness,
  freezeYear,
  NOW,
  QUALIFIER_2,
  QUALIFIER_3,
  readEntryRows,
  REGISTRAR_CATEGORY,
  seedChampionOwners,
} from './testing/year-entry-registrar-fixtures.ts';
import {
  championWeekTournamentIdOf,
  insertYearTournaments,
  YEAR,
  YEAR_SCHEDULE,
  yearEntryIdOf,
} from './testing/year-tournament-fixtures.ts';

const FROZEN_COLUMNS = {
  status: 'drawing',
  drawStartedAt: YEAR_SCHEDULE.drawAt,
} as const;

let logs: LogObject[] = [];
let events: Event[] = [];

function registrarLogs(): LogObject[] {
  return logs.filter(({ category }) => category === REGISTRAR_CATEGORY);
}

function incidentEvents(incident: string): Event[] {
  return events.filter(
    (event) => event.tags?.tournament_year_incident === incident,
  );
}

function expectNoPersonalValues(): void {
  const recorded = JSON.stringify([registrarLogs(), events]);
  for (const index of [1, 2, 3]) {
    for (const value of [
      launchIdOf(index),
      productIdOf(index),
      userIdOf(index),
    ]) {
      expect(recorded).not.toContain(value);
    }
  }
}

beforeEach(async () => {
  logs = recordLogs();
  events = installRecordingSentry();
  await seedChampionOwners();
});

afterEach(resetObservability);

describe('ChampionYearEntryRegistrar.syncChampions(予選が見つからない)', () => {
  test('予選の結果・マッチ・勝った側が見つからないWeek優勝は枠を作らず、識別子だけのログとcaptureEventを残す', async () => {
    const harness = createRegistrarHarness({
      champions: [CHAMPION_1, CHAMPION_2, CHAMPION_3],
      qualifiers: [QUALIFIER_2, QUALIFIER_3],
      matchesMissing: [3],
    });

    await expect(
      harness.registrar.syncChampions({ awardedFrom: null, now: NOW }),
    ).resolves.toEqual({ created: [yearEntryIdOf(1)], late: [], skipped: 2 });

    await expect(readEntryRows()).resolves.toEqual([
      expect.objectContaining({
        id: yearEntryIdOf(1),
        weekTournamentId: championWeekTournamentIdOf(2),
      }),
    ]);
    const missingLogs = registrarLogs();
    expect(missingLogs.map(({ level }) => level)).toEqual([
      'warning',
      'warning',
    ]);
    expect(missingLogs).toEqual([
      expect.objectContaining({
        weekTournamentId: championWeekTournamentIdOf(1),
      }),
      expect.objectContaining({
        weekTournamentId: championWeekTournamentIdOf(3),
      }),
    ]);
    expect(Object.keys(missingLogs[0] ?? {}).sort()).toEqual([
      'category',
      'level',
      'message',
      'time',
      'weekTournamentId',
    ]);
    const missingEvents = incidentEvents('qualifier-missing');
    expect(events).toHaveLength(2);
    expect(missingEvents).toHaveLength(2);
    const [event] = missingEvents;
    expect(event?.level).toBe('warning');
    expect(event?.logentry?.message).toBe(missingLogs[0]?.message);
    expect(event?.message).toBeUndefined();
    expect(event?.fingerprint).toEqual([
      'tournament-year',
      'qualifier-missing',
    ]);
    expect(missingEvents.map(({ tags }) => tags)).toStrictEqual([
      {
        tournament_year_incident: 'qualifier-missing',
        week_tournament_id: championWeekTournamentIdOf(1),
      },
      {
        tournament_year_incident: 'qualifier-missing',
        week_tournament_id: championWeekTournamentIdOf(3),
      },
    ]);
    expectNoPersonalValues();
  });

  test('予選のマッチでWeek優勝のローンチの側が勝っていなければ、枠を作らずcaptureEventする', async () => {
    const harness = createRegistrarHarness({
      champions: [CHAMPION_1],
      qualifiersLost: [1],
    });

    await expect(
      harness.registrar.syncChampions({ awardedFrom: null, now: NOW }),
    ).resolves.toEqual({ created: [], late: [], skipped: 1 });

    await expect(readEntryRows()).resolves.toEqual([]);
    expect(incidentEvents('qualifier-missing')).toHaveLength(1);
  });

  test('予選が見つからなかったWeek優勝は、次の取り込みで予選が見つかれば枠を作る', async () => {
    await createRegistrarHarness({
      champions: [CHAMPION_1],
      qualifiers: [],
    }).registrar.syncChampions({ awardedFrom: null, now: NOW });
    const harness = createRegistrarHarness({ champions: [CHAMPION_1] });

    await expect(
      harness.registrar.syncChampions({ awardedFrom: null, now: NOW }),
    ).resolves.toEqual({ created: [yearEntryIdOf(1)], late: [], skipped: 0 });

    await expect(readEntryRows()).resolves.toHaveLength(1);
  });
});

describe('ChampionYearEntryRegistrar.syncChampions(凍結済みの年への遅れ)', () => {
  test('凍結済みの年へ遅れて届いたWeek優勝は期限切れで作り、Ultrasを照会せず識別子だけのログとcaptureEventを残す', async () => {
    await insertYearTournaments([{ index: 1, columns: FROZEN_COLUMNS }]);
    const harness = createRegistrarHarness({
      champions: [CHAMPION_1],
      narrow: () => Promise.resolve(new Set([userIdOf(1)])),
      entitled: () => true,
    });

    await expect(
      harness.registrar.syncChampions({ awardedFrom: null, now: NOW }),
    ).resolves.toEqual({ created: [], late: [yearEntryIdOf(1)], skipped: 0 });

    expect(harness.narrowQueries).toEqual([]);
    expect(harness.entitlementQueries).toEqual([]);
    await expect(readEntryRows()).resolves.toEqual([
      expect.objectContaining({
        id: yearEntryIdOf(1),
        status: 'expired',
        closeReason: 'late_entry',
        classifiedYear: YEAR,
        entitlementSource: null,
        refundStatus: 'not_needed',
        closedAt: NOW,
      }),
    ]);
    const [log, ...otherLogs] = registrarLogs();
    expect(otherLogs).toEqual([]);
    expect(log?.level).toBe('warning');
    expect(Object.keys(log ?? {}).sort()).toEqual([
      'category',
      'entryId',
      'level',
      'matchId',
      'message',
      'time',
      'weekTournamentId',
    ]);
    expect(log).toMatchObject({
      weekTournamentId: championWeekTournamentIdOf(1),
      entryId: yearEntryIdOf(1),
      matchId: matchIdOf(1),
    });
    const [event, ...otherEvents] = incidentEvents('late-entry');
    expect(otherEvents).toEqual([]);
    expect(events).toHaveLength(1);
    expect(event?.level).toBe('warning');
    expect(event?.logentry?.message).toBe(log?.message);
    expect(event?.message).toBeUndefined();
    expect(event?.fingerprint).toEqual(['tournament-year', 'late-entry']);
    expect(event?.tags).toStrictEqual({
      tournament_year_incident: 'late-entry',
      week_tournament_id: championWeekTournamentIdOf(1),
    });
    expectNoPersonalValues();
  });

  test('受付中の判定の後、挿入の前に凍結した年へのWeek優勝も期限切れで作りcaptureEventする', async () => {
    await insertYearTournaments([{ index: 1 }]);
    const harness = createRegistrarHarness({
      champions: [CHAMPION_1],
      narrow: async () => {
        await freezeYear();
        return new Set([userIdOf(1)]);
      },
      entitled: () => true,
    });

    await expect(
      harness.registrar.syncChampions({ awardedFrom: null, now: NOW }),
    ).resolves.toEqual({ created: [], late: [yearEntryIdOf(1)], skipped: 0 });

    await expect(readEntryRows()).resolves.toEqual([
      expect.objectContaining({
        status: 'expired',
        closeReason: 'late_entry',
        entitlementSource: null,
        entitledAt: null,
      }),
    ]);
    expect(incidentEvents('late-entry')).toHaveLength(1);
  });

  test('遅れたWeek優勝の同じ取り込みの2回目は、枠もcaptureEventも増やさない', async () => {
    await insertYearTournaments([{ index: 1, columns: FROZEN_COLUMNS }]);
    const harness = createRegistrarHarness({ champions: [CHAMPION_1] });

    await harness.registrar.syncChampions({ awardedFrom: null, now: NOW });
    await expect(
      harness.registrar.syncChampions({ awardedFrom: null, now: NOW }),
    ).resolves.toEqual({ created: [], late: [], skipped: 0 });

    await expect(readEntryRows()).resolves.toHaveLength(1);
    expect(incidentEvents('late-entry')).toHaveLength(1);
  });

  test('組み合わせ決定の前に作った受付中の枠は、凍結の後の取り込みで期限切れに変えない', async () => {
    await insertYearTournaments([{ index: 1 }]);
    const harness = createRegistrarHarness({ champions: [CHAMPION_1] });
    await harness.registrar.syncChampions({ awardedFrom: null, now: NOW });
    await freezeYear();

    await expect(
      harness.registrar.syncChampions({ awardedFrom: null, now: NOW }),
    ).resolves.toEqual({ created: [], late: [], skipped: 0 });

    await expect(readEntryRows()).resolves.toEqual([
      expect.objectContaining({
        status: 'awaiting_payment',
        closeReason: null,
      }),
    ]);
    expect(events).toEqual([]);
  });
});
