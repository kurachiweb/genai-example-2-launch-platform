import { eq } from 'drizzle-orm';

import { yearTournamentEntries } from '../../../../db/schema/tournament/year-tournament-entries.ts';
import { yearTournaments } from '../../../../db/schema/tournament/year-tournaments.ts';
import type { IdGenerator } from '../../../core/ids/id-generator.ts';
import type {
  MatchDirectory,
  MatchRecord,
  QualifierResultRecord,
} from '../../../core/match/ports.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../../core/time/business-time.ts';
import type { UltrasEntitlements } from '../../../core/ultras/ports.ts';
import type {
  WeekChampion,
  WeekChampionDirectory,
} from '../../../core/week-tournament/ports.ts';
import { matchIdOf } from '../../match/testing/match-fixtures.ts';
import {
  db,
  insertLaunch,
  insertProduct,
  insertUser,
  launchIdOf,
  productIdOf,
  userIdOf,
} from '../../product/testing/product-fixtures.ts';
import { D1YearEntryStore } from '../d1-year-entry-store.ts';
import { D1YearTournamentStore } from '../d1-year-tournament-store.ts';
import { YearTournamentCalendar } from '../year-calendar.ts';
import { ChampionYearEntryRegistrar } from '../year-entry-registrar.ts';
import {
  championWeekTournamentIdOf,
  clearYearTournamentTables,
  YEAR,
  YEAR_SCHEDULE,
  yearEntryIdOf,
} from './year-tournament-fixtures.ts';

// 業務時刻の2026-11-24 0:00。2026年は組み合わせ決定の時刻を過ぎて行が無いため開催しなかった年になり、Week優勝は2027年の対象になる
export const NOW = new Date('2026-11-24T08:00:00.000Z');

export const REGISTRAR_CATEGORY = 'api.year-tournament.entry';

const LOSING_LAUNCH_ID = '01JD0L0SERLAVNCH0000000001';

const MATCH_DURATION_MS = 85_200_000;

const TALLY_DURATION_MS = 300_000;

export interface ChampionFixture {
  readonly index: number;
  readonly weekStart: string;
  readonly awardedAt: Date;
  readonly owner: number;
}

// 利用者1のWeek優勝(2026-W46)と、利用者2の同じ週(2026-W47)の2つのWeek優勝
export const CHAMPION_1: ChampionFixture = Object.freeze({
  index: 1,
  weekStart: '2026-11-09',
  awardedAt: new Date('2026-11-16T07:45:00.000Z'),
  owner: 1,
});

export const CHAMPION_2: ChampionFixture = Object.freeze({
  index: 2,
  weekStart: '2026-11-16',
  awardedAt: new Date('2026-11-23T07:45:00.000Z'),
  owner: 2,
});

export const CHAMPION_3: ChampionFixture = Object.freeze({
  index: 3,
  weekStart: '2026-11-16',
  awardedAt: new Date('2026-11-23T07:46:00.000Z'),
  owner: 2,
});

export interface QualifierFixture {
  readonly index: number;
  readonly matchDate: string;
  readonly upvoteCount: number;
  readonly lastUpvoteElapsedMs: number | null;
}

export const QUALIFIER_1: QualifierFixture = Object.freeze({
  index: 1,
  matchDate: '2026-11-05',
  upvoteCount: 12,
  lastUpvoteElapsedMs: 5_400_000,
});

export const QUALIFIER_2: QualifierFixture = Object.freeze({
  index: 2,
  matchDate: '2026-11-12',
  upvoteCount: 0,
  lastUpvoteElapsedMs: null,
});

export const QUALIFIER_3: QualifierFixture = Object.freeze({
  index: 3,
  matchDate: '2026-11-13',
  upvoteCount: 7,
  lastUpvoteElapsedMs: 600_000,
});

export interface PeriodQuery {
  readonly userIds: readonly string[];
  readonly from: Date;
  readonly to: Date;
}

export interface RegistrarHarness {
  readonly registrar: ChampionYearEntryRegistrar;
  readonly championQueries: Parameters<
    WeekChampionDirectory['listChampions']
  >[0][];
  readonly qualifierQueries: (readonly string[])[];
  readonly matchQueries: {
    readonly ids: readonly string[];
    readonly now: Date;
  }[];
  readonly narrowQueries: PeriodQuery[];
  readonly entitlementQueries: PeriodQuery[];
}

export interface RegistrarHarnessOptions {
  readonly champions: readonly ChampionFixture[];
  readonly qualifiers?: readonly QualifierFixture[];
  // findQualifierResultsが返しても、findMatchesが返さないマッチ
  readonly matchesMissing?: readonly number[];
  // 予選の結果は返しても、マッチの側が負けになっているマッチ
  readonly qualifiersLost?: readonly number[];
  readonly narrow?: (query: PeriodQuery) => Promise<ReadonlySet<string>>;
  readonly entitled?: (query: PeriodQuery) => boolean;
}

const unused = (): never => {
  throw new Error('この照会は使わない');
};

function dateOf(value: string): BusinessDate {
  return parseBusinessDate(value);
}

function championOf(fixture: ChampionFixture): WeekChampion {
  return {
    tournamentId: championWeekTournamentIdOf(fixture.index),
    weekStart: dateOf(fixture.weekStart),
    productId: productIdOf(fixture.index),
    launchId: launchIdOf(fixture.index),
    ownerUserId: userIdOf(fixture.owner),
    awardedAt: fixture.awardedAt,
  };
}

function matchEntryIdOf(index: number, slot: 1 | 2): string {
  return `01JD0MENTRY${String(index).padStart(14, '0')}${String(slot)}`;
}

function qualifierMatchOf(
  fixture: QualifierFixture,
  championLost: boolean,
): MatchRecord {
  const startsAt = new Date(`${fixture.matchDate}T08:00:00.000Z`);
  const endsAt = new Date(startsAt.getTime() + MATCH_DURATION_MS);
  return {
    matchId: matchIdOf(fixture.index),
    kind: 'qualifier',
    round: null,
    stage: null,
    matchDate: dateOf(fixture.matchDate),
    decision: 'votes',
    endedEarly: false,
    phase: 'finished',
    startsAt,
    endsAt,
    startedAt: startsAt,
    decidedAt: new Date(endsAt.getTime() + TALLY_DURATION_MS),
    entries: [
      {
        entryId: matchEntryIdOf(fixture.index, 1),
        slot: 1,
        launchId: LOSING_LAUNCH_ID,
        productId: null,
        ownerUserId: null,
        upvoteCount: 0,
        lastUpvotedAt: null,
        lastUpvoteElapsedMs: null,
        forfeited: false,
        result: championLost ? 'won' : 'lost',
      },
      {
        entryId: matchEntryIdOf(fixture.index, 2),
        slot: 2,
        launchId: launchIdOf(fixture.index),
        productId: productIdOf(fixture.index),
        ownerUserId: null,
        upvoteCount: fixture.upvoteCount,
        lastUpvotedAt: null,
        lastUpvoteElapsedMs: fixture.lastUpvoteElapsedMs,
        forfeited: false,
        result: championLost ? 'lost' : 'won',
      },
    ],
  };
}

function qualifierResultOf(fixture: QualifierFixture): QualifierResultRecord {
  const match = qualifierMatchOf(fixture, false);
  return {
    launchId: launchIdOf(fixture.index),
    matchId: match.matchId,
    result: 'won',
    upvoteCount: fixture.upvoteCount,
    lastUpvotedAt: null,
    decidedAt: match.decidedAt ?? NOW,
  };
}

function sequentialEntryIds(): IdGenerator {
  let next = 1;
  return {
    generate: () => {
      const id = yearEntryIdOf(next);
      next += 1;
      return id;
    },
  };
}

function createMatches(
  options: RegistrarHarnessOptions,
  harness: Omit<RegistrarHarness, 'registrar'>,
): MatchDirectory {
  const qualifiers = options.qualifiers ?? [
    QUALIFIER_1,
    QUALIFIER_2,
    QUALIFIER_3,
  ];
  const missing = new Set(options.matchesMissing ?? []);
  const lost = new Set(options.qualifiersLost ?? []);
  return {
    findQualifierResults: (launchIds) => {
      harness.qualifierQueries.push(launchIds);
      return Promise.resolve(
        new Map(
          qualifiers
            .filter(({ index }) => launchIds.includes(launchIdOf(index)))
            .map((fixture) => [
              launchIdOf(fixture.index),
              qualifierResultOf(fixture),
            ]),
        ),
      );
    },
    findMatches: (ids, now) => {
      harness.matchQueries.push({ ids, now });
      return Promise.resolve(
        new Map(
          qualifiers
            .filter(
              ({ index }) =>
                !missing.has(index) && ids.includes(matchIdOf(index)),
            )
            .map((fixture) => [
              matchIdOf(fixture.index),
              qualifierMatchOf(fixture, lost.has(fixture.index)),
            ]),
        ),
      );
    },
    listForDate: unused,
    listByLaunches: unused,
    summarizeDaily: unused,
  };
}

function createEntitlements(
  options: RegistrarHarnessOptions,
  harness: Omit<RegistrarHarness, 'registrar'>,
): UltrasEntitlements {
  return {
    isEntitledAt: unused,
    wasEntitledDuring: (userId, from, to) => {
      const query = { userIds: [userId], from, to };
      harness.entitlementQueries.push(query);
      return Promise.resolve(options.entitled?.(query) ?? false);
    },
    entitledUsersAt: unused,
    entitledUsersDuring: (userIds, from, to) => {
      const query = { userIds, from, to };
      harness.narrowQueries.push(query);
      return options.narrow?.(query) ?? Promise.resolve(new Set<string>());
    },
    currentPlan: unused,
  };
}

export function createRegistrarHarness(
  options: RegistrarHarnessOptions,
): RegistrarHarness {
  const harness: Omit<RegistrarHarness, 'registrar'> = {
    championQueries: [],
    qualifierQueries: [],
    matchQueries: [],
    narrowQueries: [],
    entitlementQueries: [],
  };
  const champions: WeekChampionDirectory = {
    listChampions: (input) => {
      harness.championQueries.push(input);
      return Promise.resolve(options.champions.map(championOf));
    },
  };
  return {
    ...harness,
    registrar: new ChampionYearEntryRegistrar({
      appName: 'api',
      champions,
      matches: createMatches(options, harness),
      entitlements: createEntitlements(options, harness),
      calendar: new YearTournamentCalendar(new D1YearTournamentStore(db)),
      store: new D1YearEntryStore(db),
      ids: sequentialEntryIds(),
    }),
  };
}

export function readEntryRows() {
  return db
    .select()
    .from(yearTournamentEntries)
    .orderBy(yearTournamentEntries.id);
}

export async function freezeYear(): Promise<void> {
  await db
    .update(yearTournaments)
    .set({ status: 'drawing', drawStartedAt: YEAR_SCHEDULE.drawAt })
    .where(eq(yearTournaments.year, YEAR));
}

// 利用者1・2と、利用者1のプロダクト1、利用者2のプロダクト2・3を、同じ番号のローンチ付きで作る
export async function seedChampionOwners(): Promise<void> {
  await clearYearTournamentTables();
  await insertUser(1);
  await insertUser(2);
  for (const index of [1, 2, 3]) {
    await insertProduct(index, index === 1 ? 1 : 2);
    await insertLaunch(index, index);
  }
}
