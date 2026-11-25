import type { Event } from '@sentry/cloudflare';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { weekTournamentEntries } from '../../../db/schema/tournament/week-tournament-entries.ts';
import { weekTournaments } from '../../../db/schema/tournament/week-tournaments.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import type { LogObject } from '../../core/logging/log-record.ts';
import type { MatchRecord } from '../../core/match/ports.ts';
import type { UltrasEntitlements } from '../../core/ultras/ports.ts';
import { D1MatchDirectory } from '../match/d1-match-directory.ts';
import {
  DECIDED_AT,
  minutesAfterStart,
  settledQualifier,
  STARTS_AT,
} from '../match/testing/directory-fixtures.ts';
import {
  insertMatch,
  MATCH_DATE,
  matchIdOf,
  type MatchFixture,
} from '../match/testing/match-fixtures.ts';
import {
  db,
  insertLaunch,
  insertProduct,
  insertUser,
  launchIdOf,
  productIdOf,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import {
  installRecordingSentry,
  recordLogs,
  resetObservability,
} from '../tournament/testing/observability-fixtures.ts';
import { D1WeekTournamentStore } from './d1-week-tournament-store.ts';
import {
  clearWeekTournamentTables,
  insertWeekTournaments,
  WEEK_START,
  WEEK_WINDOW,
  weekEntryIdOf,
  weekTournamentIdOf,
} from './testing/week-tournament-fixtures.ts';
import { QualifierWeekEntryRegistrar } from './week-entry-registrar.ts';

const AT = new Date(DECIDED_AT.getTime() + 120_000);

const REGISTRAR_CATEGORY = 'api.week-tournament.entry';

interface EntitlementQuery {
  readonly userId: string;
  readonly from: Date;
  readonly to: Date;
}

interface RegistrarHarness {
  readonly registrar: QualifierWeekEntryRegistrar;
  readonly queries: EntitlementQuery[];
}

const unused = (): never => {
  throw new Error('この判定は使わない');
};

function sequentialEntryIds(): IdGenerator {
  let next = 1;
  return {
    generate: () => {
      const id = weekEntryIdOf(next);
      next += 1;
      return id;
    },
  };
}

function createRegistrar(
  answer: (query: EntitlementQuery) => Promise<boolean> = () =>
    Promise.resolve(false),
): RegistrarHarness {
  const queries: EntitlementQuery[] = [];
  const entitlements: UltrasEntitlements = {
    isEntitledAt: unused,
    wasEntitledDuring: (userId, from, to) => {
      const query = { userId, from, to };
      queries.push(query);
      return answer(query);
    },
    entitledUsersAt: unused,
    entitledUsersDuring: unused,
    currentPlan: unused,
  };
  return {
    registrar: new QualifierWeekEntryRegistrar(
      new D1WeekTournamentStore(db),
      entitlements,
      sequentialEntryIds(),
      'api',
    ),
    queries,
  };
}

async function readMatch(fixture: MatchFixture): Promise<MatchRecord> {
  await insertMatch(fixture);
  const matches = await new D1MatchDirectory(db).findMatches(
    [matchIdOf(fixture.index)],
    AT,
  );
  const match = matches.get(matchIdOf(fixture.index));
  if (match === undefined) {
    throw new Error('マッチを読めませんでした');
  }
  return match;
}

function readEntryRows() {
  return db.select().from(weekTournamentEntries);
}

function readTournamentRows() {
  return db.select().from(weekTournaments);
}

function decidedOf(
  index: number,
  decision: NonNullable<MatchFixture['columns']>['decision'],
  entries: MatchFixture['entries'],
): MatchFixture {
  return {
    index,
    columns: { startedAt: STARTS_AT, decidedAt: DECIDED_AT, decision },
    entries,
  };
}

// 利用者1・2と、利用者1のプロダクト1・2、利用者2のプロダクト3・4を、同じ番号のローンチ付きで作る
async function seedOwners(): Promise<void> {
  await clearWeekTournamentTables();
  await insertUser(1);
  await insertUser(2);
  for (const index of [1, 2, 3, 4]) {
    await insertProduct(index, index <= 2 ? 1 : 2);
    await insertLaunch(index, index, { launchDate: MATCH_DATE });
  }
}

async function freezeWeek(): Promise<void> {
  await db
    .update(weekTournaments)
    .set({ status: 'drawing', drawStartedAt: WEEK_WINDOW.drawAt })
    .where(eq(weekTournaments.weekStart, WEEK_START));
}

let logs: LogObject[] = [];
let events: Event[] = [];

function registrarLogs(): LogObject[] {
  return logs.filter(({ category }) => category === REGISTRAR_CATEGORY);
}

function lateEntryEvents(): Event[] {
  return events.filter(
    (event) => event.tags?.tournament_incident === 'late-entry',
  );
}

beforeEach(async () => {
  logs = recordLogs();
  events = installRecordingSentry();
  await seedOwners();
});

afterEach(resetObservability);

describe('QualifierWeekEntryRegistrar.registerFromMatch(勝利の側)', () => {
  test('Upvote数による勝利の側だけに、ローンチ日の週の受付中の枠を予選の確定値のまま作る', async () => {
    const match = await readMatch(settledQualifier(1));
    const { registrar, queries } = createRegistrar();

    await expect(registrar.registerFromMatch(match, AT)).resolves.toEqual([
      weekEntryIdOf(1),
    ]);

    const [tournament] = await readTournamentRows();
    expect(tournament).toMatchObject({
      weekStart: WEEK_START,
      status: 'open',
      deadlineAt: WEEK_WINDOW.deadlineAt,
    });
    await expect(readEntryRows()).resolves.toEqual([
      expect.objectContaining({
        id: weekEntryIdOf(1),
        tournamentId: tournament?.id,
        launchId: launchIdOf(1),
        productId: productIdOf(1),
        ownerUserId: userIdOf(1),
        launchDate: MATCH_DATE,
        qualifierMatchId: matchIdOf(1),
        qualifierUpvoteCount: 12,
        qualifierLastUpvoteElapsedMs: 842 * 60_000,
        wonAt: DECIDED_AT,
        status: 'awaiting_payment',
        entitlementSource: null,
        entitledAt: null,
        closeReason: null,
        closedAt: null,
        createdAt: AT,
      }),
    ]);
    expect(queries).toEqual([
      { userId: userIdOf(1), from: DECIDED_AT, to: WEEK_WINDOW.deadlineAt },
    ]);
  });

  test('不戦勝の側に、Upvote数0と最終Upvote時間なしの枠を作る', async () => {
    const match = await readMatch(
      decidedOf(1, 'bye', [
        {
          index: 11,
          launch: 3,
          product: 3,
          owner: 2,
          columns: { result: 'bye' },
        },
      ]),
    );
    const { registrar } = createRegistrar();

    await expect(registrar.registerFromMatch(match, AT)).resolves.toEqual([
      weekEntryIdOf(1),
    ]);

    await expect(readEntryRows()).resolves.toEqual([
      expect.objectContaining({
        launchId: launchIdOf(3),
        ownerUserId: userIdOf(2),
        qualifierUpvoteCount: 0,
        qualifierLastUpvoteElapsedMs: null,
        wonAt: DECIDED_AT,
        status: 'awaiting_payment',
      }),
    ]);
  });

  test('相手の退会等による勝利の側に枠を作り、不戦敗の側には作らない', async () => {
    const match = await readMatch(
      decidedOf(1, 'walkover', [
        {
          index: 11,
          launch: 1,
          product: 1,
          owner: 1,
          columns: {
            upvoteCount: 4,
            lastUpvotedAt: minutesAfterStart(30),
            lastUpvoteSeq: 4,
            result: 'walkover',
          },
        },
        {
          index: 12,
          launch: 3,
          product: 3,
          owner: 2,
          columns: {
            upvoteCount: 7,
            forfeitedAt: minutesAfterStart(60),
            result: 'lost',
          },
        },
      ]),
    );
    const { registrar } = createRegistrar();

    await expect(registrar.registerFromMatch(match, AT)).resolves.toEqual([
      weekEntryIdOf(1),
    ]);

    await expect(readEntryRows()).resolves.toEqual([
      expect.objectContaining({
        launchId: launchIdOf(1),
        qualifierUpvoteCount: 4,
        qualifierLastUpvoteElapsedMs: 30 * 60_000,
      }),
    ]);
  });

  test('勝利の時点でUltrasの期間内の投稿者には、参加資格(Ultras)の枠を作る', async () => {
    const match = await readMatch(settledQualifier(1));
    const { registrar } = createRegistrar(() => Promise.resolve(true));

    await registrar.registerFromMatch(match, AT);

    await expect(readEntryRows()).resolves.toEqual([
      expect.objectContaining({
        status: 'entitled',
        entitlementSource: 'ultras',
        entitledAt: AT,
        closeReason: null,
        closedAt: null,
        purchaseId: null,
      }),
    ]);
  });

  test('決済期限の後に確定した勝利は、Ultrasを問い合わせず受付中の枠で作る', async () => {
    const decidedAfterDeadline = new Date(
      WEEK_WINDOW.deadlineAt.getTime() + 60_000,
    );
    const match = {
      ...(await readMatch(settledQualifier(1))),
      decidedAt: decidedAfterDeadline,
    };
    const { registrar, queries } = createRegistrar(() => Promise.resolve(true));

    await registrar.registerFromMatch(match, decidedAfterDeadline);

    await expect(readEntryRows()).resolves.toEqual([
      expect.objectContaining({
        wonAt: decidedAfterDeadline,
        status: 'awaiting_payment',
        entitlementSource: null,
      }),
    ]);
    expect(queries).toEqual([]);
  });
});

describe('QualifierWeekEntryRegistrar.registerFromMatch(枠を作らないマッチ)', () => {
  test('両者敗北のマッチには枠も週も作らない', async () => {
    const match = await readMatch(
      decidedOf(1, 'both_forfeited', [
        {
          index: 11,
          launch: 1,
          product: 1,
          owner: 1,
          columns: { forfeitedAt: minutesAfterStart(10), result: 'lost' },
        },
        {
          index: 12,
          launch: 3,
          product: 3,
          owner: 2,
          columns: { forfeitedAt: minutesAfterStart(20), result: 'lost' },
        },
      ]),
    );
    const { registrar, queries } = createRegistrar();

    await expect(registrar.registerFromMatch(match, AT)).resolves.toEqual([]);

    await expect(readEntryRows()).resolves.toEqual([]);
    await expect(readTournamentRows()).resolves.toEqual([]);
    expect(queries).toEqual([]);
  });

  test('トーナメントのマッチの勝利には枠を作らない', async () => {
    const qualifier = settledQualifier(1);
    const match = await readMatch({
      ...qualifier,
      columns: {
        ...qualifier.columns,
        kind: 'week',
        round: 1,
        stage: null,
      },
    });
    const { registrar } = createRegistrar();

    await expect(registrar.registerFromMatch(match, AT)).resolves.toEqual([]);

    await expect(readEntryRows()).resolves.toEqual([]);
    await expect(readTournamentRows()).resolves.toEqual([]);
  });

  test('確定していないマッチには枠を作らない', async () => {
    const match = await readMatch({
      index: 1,
      columns: { startedAt: STARTS_AT },
      entries: settledQualifier(1).entries.map((entry) => ({
        ...entry,
        columns: { ...entry.columns, result: null },
      })),
    });
    const { registrar } = createRegistrar();

    await expect(registrar.registerFromMatch(match, AT)).resolves.toEqual([]);

    await expect(readEntryRows()).resolves.toEqual([]);
  });

  test('紐付けを解除した勝利の側には枠を作らない', async () => {
    const match = await readMatch(
      decidedOf(1, 'bye', [
        {
          index: 11,
          launch: null,
          product: null,
          owner: null,
          columns: { result: 'bye' },
        },
      ]),
    );
    const { registrar } = createRegistrar();

    await expect(registrar.registerFromMatch(match, AT)).resolves.toEqual([]);

    await expect(readEntryRows()).resolves.toEqual([]);
  });
});

describe('QualifierWeekEntryRegistrar.registerFromMatch(重複と凍結)', () => {
  test('同じマッチを2回処理しても枠は1つで、2回目は作った枠を返さない', async () => {
    const match = await readMatch(settledQualifier(1));
    const { registrar } = createRegistrar();

    await registrar.registerFromMatch(match, AT);
    await expect(registrar.registerFromMatch(match, AT)).resolves.toEqual([]);

    await expect(readEntryRows()).resolves.toEqual([
      expect.objectContaining({ id: weekEntryIdOf(1) }),
    ]);
    await expect(readTournamentRows()).resolves.toHaveLength(1);
  });

  test('凍結済みの週への遅れた勝利は期限切れで記録し、識別子だけのログとcaptureEventを残す', async () => {
    await insertWeekTournaments([{ index: 1 }]);
    await freezeWeek();
    const match = await readMatch(settledQualifier(1));
    const { registrar, queries } = createRegistrar(() => Promise.resolve(true));

    await expect(registrar.registerFromMatch(match, AT)).resolves.toEqual([
      weekEntryIdOf(1),
    ]);

    await expect(readEntryRows()).resolves.toEqual([
      expect.objectContaining({
        id: weekEntryIdOf(1),
        tournamentId: weekTournamentIdOf(1),
        status: 'expired',
        closeReason: 'late_entry',
        closedAt: AT,
        entitlementSource: null,
        refundStatus: 'none',
      }),
    ]);
    expect(queries).toEqual([]);
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
      'tournamentId',
    ]);
    expect(log).toMatchObject({
      tournamentId: weekTournamentIdOf(1),
      entryId: weekEntryIdOf(1),
      matchId: matchIdOf(1),
    });
    const [event, ...otherEvents] = lateEntryEvents();
    expect(otherEvents).toEqual([]);
    expect(event?.level).toBe('warning');
    expect(event?.logentry?.message).toBe(log?.message);
    expect(event?.message).toBeUndefined();
    expect(event?.fingerprint).toEqual(['tournament', 'late-entry']);
    expect(event?.tags).toStrictEqual({
      tournament_incident: 'late-entry',
      tournament_id: weekTournamentIdOf(1),
    });
    const recorded = JSON.stringify([logs, events]);
    for (const value of [launchIdOf(1), productIdOf(1), userIdOf(1)]) {
      expect(recorded).not.toContain(value);
    }
  });

  test('凍結済みの週への同じ遅れた勝利の2回目は枠もcaptureEventも増やさない', async () => {
    await insertWeekTournaments([{ index: 1 }]);
    await freezeWeek();
    const match = await readMatch(settledQualifier(1));
    const { registrar } = createRegistrar();

    await registrar.registerFromMatch(match, AT);
    await expect(registrar.registerFromMatch(match, AT)).resolves.toEqual([]);

    await expect(readEntryRows()).resolves.toHaveLength(1);
    expect(lateEntryEvents()).toHaveLength(1);
  });

  test('凍結前に受付中で作った枠は、凍結の後の再処理で期限切れに変えない', async () => {
    const match = await readMatch(settledQualifier(1));
    const { registrar } = createRegistrar();
    await registrar.registerFromMatch(match, AT);
    await freezeWeek();

    await expect(registrar.registerFromMatch(match, AT)).resolves.toEqual([]);

    await expect(readEntryRows()).resolves.toEqual([
      expect.objectContaining({
        status: 'awaiting_payment',
        closeReason: null,
      }),
    ]);
    expect(lateEntryEvents()).toEqual([]);
  });

  test('未凍結の判定の後、挿入の前に凍結した週への勝利は期限切れで記録しcaptureEventする', async () => {
    const match = await readMatch(settledQualifier(1));
    const { registrar } = createRegistrar(async () => {
      await freezeWeek();
      return true;
    });

    await expect(registrar.registerFromMatch(match, AT)).resolves.toEqual([
      weekEntryIdOf(1),
    ]);

    await expect(readEntryRows()).resolves.toEqual([
      expect.objectContaining({
        status: 'expired',
        closeReason: 'late_entry',
        entitlementSource: null,
      }),
    ]);
    expect(lateEntryEvents()).toHaveLength(1);
  });
});
