import { matchEntries } from '../../../../db/schema/match/match-entries.ts';
import { matchEventHandlerRuns } from '../../../../db/schema/match/match-event-handler-runs.ts';
import { matchEvents } from '../../../../db/schema/match/match-events.ts';
import { matchUpvotes } from '../../../../db/schema/match/match-upvotes.ts';
import { matches } from '../../../../db/schema/match/matches.ts';
import { qualifierPairings } from '../../../../db/schema/match/qualifier-pairings.ts';
import { qualifierWindow } from '../../../core/match/match-model.ts';
import { parseBusinessDate } from '../../../core/time/business-time.ts';
import {
  clearProductTables,
  db,
  launchIdOf,
  productIdOf,
  T0,
  userIdOf,
} from '../../product/testing/product-fixtures.ts';

// 1行が15〜20個のバインド変数を使うため、上限(100)に収まる行数ずつ追加する
const ROWS_PER_INSERT = 4;

export const MATCH_DATE = '2026-11-20';

export const MATCH_WINDOW = qualifierWindow(parseBusinessDate(MATCH_DATE));

type MatchRow = typeof matches.$inferInsert;
type EntryRow = typeof matchEntries.$inferInsert;
type UpvoteRow = typeof matchUpvotes.$inferInsert;

export function matchIdOf(index: number): string {
  return `01JD0MTCH${String(index).padStart(17, '0')}`;
}

export function entryIdOf(index: number): string {
  return `01JD0ENTR${String(index).padStart(17, '0')}`;
}

export function upvoteIdOf(index: number): string {
  return `01JD0UPVT${String(index).padStart(17, '0')}`;
}

export interface EntryFixture {
  readonly index: number;
  // 紐付けを解除した側はnull
  readonly launch: number | null;
  readonly product: number | null;
  readonly owner: number | null;
  readonly columns?: Partial<EntryRow>;
}

export interface MatchFixture {
  readonly index: number;
  readonly columns?: Partial<MatchRow>;
  readonly entries: readonly EntryFixture[];
}

function matchRowOf({ index, columns = {} }: MatchFixture): MatchRow {
  return {
    id: matchIdOf(index),
    kind: 'qualifier',
    matchDate: MATCH_DATE,
    startsAt: MATCH_WINDOW.startsAt,
    endsAt: MATCH_WINDOW.endsAt,
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  };
}

function entryRowsOf(match: MatchFixture): EntryRow[] {
  const row = matchRowOf(match);
  return match.entries.map((entry, position) => ({
    id: entryIdOf(entry.index),
    matchId: matchIdOf(match.index),
    slot: position + 1,
    matchKind: row.kind,
    matchDate: row.matchDate,
    launchId: entry.launch === null ? null : launchIdOf(entry.launch),
    productId: entry.product === null ? null : productIdOf(entry.product),
    ownerUserId: entry.owner === null ? null : userIdOf(entry.owner),
    createdAt: T0,
    updatedAt: T0,
    ...entry.columns,
  }));
}

async function insertInChunks<Row>(
  rows: readonly Row[],
  insert: (part: Row[]) => Promise<unknown>,
): Promise<void> {
  for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
    await insert(rows.slice(start, start + ROWS_PER_INSERT));
  }
}

export async function insertMatches(
  fixtures: readonly MatchFixture[],
): Promise<void> {
  await insertInChunks(fixtures.map(matchRowOf), (part) =>
    db.insert(matches).values(part),
  );
  await insertInChunks(fixtures.flatMap(entryRowsOf), (part) =>
    db.insert(matchEntries).values(part),
  );
}

export async function insertMatch(fixture: MatchFixture): Promise<void> {
  await insertMatches([fixture]);
}

export interface UpvoteFixture {
  readonly index: number;
  readonly match: number;
  readonly entry: number;
  readonly user: number;
  readonly upvotedAt: Date;
  readonly columns?: Partial<UpvoteRow>;
}

function upvoteRowOf(fixture: UpvoteFixture): UpvoteRow {
  return {
    id: upvoteIdOf(fixture.index),
    matchId: matchIdOf(fixture.match),
    entryId: entryIdOf(fixture.entry),
    userId: userIdOf(fixture.user),
    matchDate: MATCH_DATE,
    upvotedAt: fixture.upvotedAt,
    seq: fixture.index,
    createdAt: T0,
    updatedAt: T0,
    ...fixture.columns,
  };
}

export async function insertUpvotes(
  fixtures: readonly UpvoteFixture[],
): Promise<void> {
  await insertInChunks(fixtures.map(upvoteRowOf), (part) =>
    db.insert(matchUpvotes).values(part),
  );
}

// 外部キーの参照元から先に消す
export async function clearMatchTables(): Promise<void> {
  await db.delete(matchEventHandlerRuns);
  await db.delete(matchEvents);
  await db.delete(matchUpvotes);
  await db.delete(matchEntries);
  await db.delete(matches);
  await db.delete(qualifierPairings);
  await clearProductTables();
}
