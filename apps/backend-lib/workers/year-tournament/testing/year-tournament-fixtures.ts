import { yearTournamentEntries } from '../../../../db/schema/tournament/year-tournament-entries.ts';
import { yearTournaments } from '../../../../db/schema/tournament/year-tournaments.ts';
import {
  defaultFinalDate,
  type YearSchedule,
  yearScheduleFor,
} from '../../../core/year-tournament/year-schedule.ts';
import { matchIdOf } from '../../match/testing/match-fixtures.ts';
import {
  db,
  launchIdOf,
  productIdOf,
  T0,
  userIdOf,
} from '../../product/testing/product-fixtures.ts';
import { clearBracketTables } from '../../tournament/testing/bracket-fixtures.ts';
import { clearWeekTournamentRows } from '../../week-tournament/testing/week-tournament-fixtures.ts';

// 1行が25個前後のバインド変数を使うため、上限(100)に収まる行数ずつ追加する
const ROWS_PER_INSERT = 3;

// 2027年の既定の決勝日は5/30(日)、決済期限日は5/24(月)
export const YEAR = 2027;

export const YEAR_SCHEDULE: YearSchedule = defaultScheduleOf(YEAR);

type YearTournamentRow = typeof yearTournaments.$inferInsert;
type YearEntryRow = typeof yearTournamentEntries.$inferInsert;

export function defaultScheduleOf(year: number): YearSchedule {
  return yearScheduleFor(year, defaultFinalDate(year));
}

export function yearTournamentIdOf(index: number): string {
  return `01JD0YTRN${String(index).padStart(17, '0')}`;
}

export function yearEntryIdOf(index: number): string {
  return `01JD0YENT${String(index).padStart(17, '0')}`;
}

export function championWeekTournamentIdOf(index: number): string {
  return `01JD0WTRN${String(index).padStart(17, '0')}`;
}

export interface YearTournamentFixture {
  readonly index: number;
  readonly year?: number;
  readonly columns?: Partial<YearTournamentRow>;
}

export interface YearEntryFixture {
  readonly index: number;
  // 紐付けを解除した枠はnull
  readonly launch: number | null;
  readonly product: number | null;
  readonly owner: number | null;
  readonly columns?: Partial<YearEntryRow>;
}

async function insertInChunks<Row>(
  rows: readonly Row[],
  insert: (part: Row[]) => Promise<unknown>,
): Promise<void> {
  for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
    await insert(rows.slice(start, start + ROWS_PER_INSERT));
  }
}

function yearTournamentRowOf(
  fixture: YearTournamentFixture,
): YearTournamentRow {
  const schedule = defaultScheduleOf(fixture.year ?? YEAR);
  return {
    id: yearTournamentIdOf(fixture.index),
    year: schedule.year,
    finalDate: schedule.finalDate,
    finalDateSource: 'default',
    deadlineDate: schedule.deadlineDate,
    acceptUntil: schedule.acceptUntil,
    deadlineAt: schedule.deadlineAt,
    drawAt: schedule.drawAt,
    changeLockAt: schedule.changeLockAt,
    status: 'open',
    createdAt: T0,
    updatedAt: T0,
    ...fixture.columns,
  };
}

function yearEntryRowOf(fixture: YearEntryFixture): YearEntryRow {
  return {
    id: yearEntryIdOf(fixture.index),
    weekTournamentId: championWeekTournamentIdOf(fixture.index),
    weekPeriod: '2026-W47',
    launchId: fixture.launch === null ? null : launchIdOf(fixture.launch),
    productId: fixture.product === null ? null : productIdOf(fixture.product),
    ownerUserId: fixture.owner === null ? null : userIdOf(fixture.owner),
    launchDate: '2026-11-20',
    qualifierMatchId: matchIdOf(fixture.index),
    qualifierUpvoteCount: 10,
    qualifierLastUpvoteElapsedMs: 3_600_000,
    awardedAt: new Date('2026-11-24T07:45:00.000Z'),
    awardedDate: '2026-11-23',
    status: 'awaiting_payment',
    createdAt: T0,
    updatedAt: T0,
    ...fixture.columns,
  };
}

export async function insertYearTournaments(
  fixtures: readonly YearTournamentFixture[],
): Promise<void> {
  await insertInChunks(fixtures.map(yearTournamentRowOf), (part) =>
    db.insert(yearTournaments).values(part),
  );
}

export async function insertYearEntries(
  fixtures: readonly YearEntryFixture[],
): Promise<void> {
  await insertInChunks(fixtures.map(yearEntryRowOf), (part) =>
    db.insert(yearTournamentEntries).values(part),
  );
}

export async function clearYearTournamentRows(): Promise<void> {
  await db.delete(yearTournamentEntries);
  await db.delete(yearTournaments);
}

// 外部キーの参照元から先に消す
export async function clearYearTournamentTables(): Promise<void> {
  await clearYearTournamentRows();
  await clearWeekTournamentRows();
  await clearBracketTables();
}
