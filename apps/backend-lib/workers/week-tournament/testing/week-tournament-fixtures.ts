import { weekTournamentEntries } from '../../../../db/schema/tournament/week-tournament-entries.ts';
import { weekTournaments } from '../../../../db/schema/tournament/week-tournaments.ts';
import { parseBusinessDate } from '../../../core/time/business-time.ts';
import { entryWindowFor } from '../../../core/week-tournament/week-schedule.ts';
import { matchIdOf } from '../../match/testing/match-fixtures.ts';
import {
  db,
  launchIdOf,
  productIdOf,
  T0,
  userIdOf,
} from '../../product/testing/product-fixtures.ts';
import {
  clearBracketTables,
  entryRefOf,
  tournamentIdOf,
} from '../../tournament/testing/bracket-fixtures.ts';

// 1行が20個前後のバインド変数を使うため、上限(100)に収まる行数ずつ追加する
const ROWS_PER_INSERT = 4;

// 2026-11-16(月)の週。組み合わせ決定は翌週月曜日23:45(UTC-08:00)
export const WEEK_START = parseBusinessDate('2026-11-16');

export const WEEK_WINDOW = entryWindowFor(WEEK_START);

type WeekTournamentRow = typeof weekTournaments.$inferInsert;
type WeekEntryRow = typeof weekTournamentEntries.$inferInsert;

// ブラケットの補助の識別子と同じ値にし、ブラケットの記録と週のトーナメント・参加の枠を同じ番号で結べるようにする
export function weekTournamentIdOf(index: number): string {
  return tournamentIdOf(index);
}

export function weekEntryIdOf(index: number): string {
  return entryRefOf(index);
}

export function qualifierMatchIdOf(index: number): string {
  return matchIdOf(index);
}

export interface WeekTournamentFixture {
  readonly index: number;
  readonly weekStart?: string;
  readonly columns?: Partial<WeekTournamentRow>;
}

export interface WeekEntryFixture {
  readonly index: number;
  readonly tournament: number;
  // 紐付けを解除した枠はnull
  readonly launch: number | null;
  readonly product: number | null;
  readonly owner: number | null;
  readonly columns?: Partial<WeekEntryRow>;
}

async function insertInChunks<Row>(
  rows: readonly Row[],
  insert: (part: Row[]) => Promise<unknown>,
): Promise<void> {
  for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
    await insert(rows.slice(start, start + ROWS_PER_INSERT));
  }
}

function weekTournamentRowOf(
  fixture: WeekTournamentFixture,
): WeekTournamentRow {
  const window = entryWindowFor(
    parseBusinessDate(fixture.weekStart ?? WEEK_START),
  );
  return {
    id: weekTournamentIdOf(fixture.index),
    weekStart: window.weekStart,
    acceptUntil: window.acceptUntil,
    deadlineAt: window.deadlineAt,
    drawAt: window.drawAt,
    status: 'open',
    createdAt: T0,
    updatedAt: T0,
    ...fixture.columns,
  };
}

function weekEntryRowOf(fixture: WeekEntryFixture): WeekEntryRow {
  return {
    id: weekEntryIdOf(fixture.index),
    tournamentId: weekTournamentIdOf(fixture.tournament),
    launchId: fixture.launch === null ? null : launchIdOf(fixture.launch),
    productId: fixture.product === null ? null : productIdOf(fixture.product),
    ownerUserId: fixture.owner === null ? null : userIdOf(fixture.owner),
    launchDate: '2026-11-20',
    qualifierMatchId: qualifierMatchIdOf(fixture.index),
    qualifierUpvoteCount: 10,
    qualifierLastUpvoteElapsedMs: 3_600_000,
    wonAt: new Date('2026-11-21T08:00:00.000Z'),
    status: 'awaiting_payment',
    createdAt: T0,
    updatedAt: T0,
    ...fixture.columns,
  };
}

export async function insertWeekTournaments(
  fixtures: readonly WeekTournamentFixture[],
): Promise<void> {
  await insertInChunks(fixtures.map(weekTournamentRowOf), (part) =>
    db.insert(weekTournaments).values(part),
  );
}

export async function insertWeekEntries(
  fixtures: readonly WeekEntryFixture[],
): Promise<void> {
  await insertInChunks(fixtures.map(weekEntryRowOf), (part) =>
    db.insert(weekTournamentEntries).values(part),
  );
}

// 予選の確定のマッチイベントの処理が枠と週の行を作るため、マッチ・プロダクトの行を消す上流の機能のテストは先にこれを呼ぶ
export async function clearWeekTournamentRows(): Promise<void> {
  await db.delete(weekTournamentEntries);
  await db.delete(weekTournaments);
}

// 外部キーの参照元から先に消す
export async function clearWeekTournamentTables(): Promise<void> {
  await clearWeekTournamentRows();
  await clearBracketTables();
}
