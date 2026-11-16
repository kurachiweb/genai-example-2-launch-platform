import { bracketMatches } from '../../../../db/schema/tournament/bracket-matches.ts';
import { bracketParticipants } from '../../../../db/schema/tournament/bracket-participants.ts';
import { tournamentBrackets } from '../../../../db/schema/tournament/tournament-brackets.ts';
import { bracketShape } from '../../../core/tournament/bracket-shape.ts';
import { clearMatchTables } from '../../match/testing/match-fixtures.ts';
import {
  db,
  launchIdOf,
  productIdOf,
  T0,
  userIdOf,
} from '../../product/testing/product-fixtures.ts';

// 1行が15個前後のバインド変数を使うため、上限(100)に収まる行数ずつ追加する
const ROWS_PER_INSERT = 5;

type BracketRow = typeof tournamentBrackets.$inferInsert;
type ParticipantRow = typeof bracketParticipants.$inferInsert;
type BracketMatchRow = typeof bracketMatches.$inferInsert;

export function bracketIdOf(index: number): string {
  return `01JD0BRKT${String(index).padStart(17, '0')}`;
}

export function tournamentIdOf(index: number): string {
  return `01JD0TRNM${String(index).padStart(17, '0')}`;
}

export function participantIdOf(index: number): string {
  return `01JD0BPRT${String(index).padStart(17, '0')}`;
}

export function entryRefOf(index: number): string {
  return `01JD0WENT${String(index).padStart(17, '0')}`;
}

export function bracketMatchIdOf(index: number): string {
  return `01JD0BMTC${String(index).padStart(17, '0')}`;
}

export interface BracketFixture {
  readonly index: number;
  readonly kind?: BracketRow['kind'];
  readonly tournament?: number;
  readonly participantCount: number;
  readonly columns?: Partial<BracketRow>;
}

export interface ParticipantFixture {
  readonly index: number;
  readonly bracket: number;
  readonly participantNo: number;
  readonly entry: number;
  // 紐付けを解除した参加者はnull
  readonly launch: number | null;
  readonly product: number | null;
  readonly owner: number | null;
  readonly columns?: Partial<ParticipantRow>;
}

export interface BracketMatchFixture {
  readonly index: number;
  readonly bracket: number;
  readonly round: number;
  readonly position: number;
  readonly participantNos: readonly [number] | readonly [number, number];
  readonly columns?: Partial<BracketMatchRow>;
}

async function insertInChunks<Row>(
  rows: readonly Row[],
  insert: (part: Row[]) => Promise<unknown>,
): Promise<void> {
  for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
    await insert(rows.slice(start, start + ROWS_PER_INSERT));
  }
}

function bracketRowOf(fixture: BracketFixture): BracketRow {
  const shape = bracketShape(fixture.participantCount);
  return {
    id: bracketIdOf(fixture.index),
    kind: fixture.kind ?? 'week',
    tournamentId: tournamentIdOf(fixture.tournament ?? fixture.index),
    participantCount: shape.participantCount,
    seedCount: shape.seedCount,
    secondRoundSize: shape.secondRoundSize,
    roundCount: shape.roundCount,
    firstRoundDate: '2026-11-24',
    status: 'active',
    createdAt: T0,
    updatedAt: T0,
    ...fixture.columns,
  };
}

function participantRowOf(fixture: ParticipantFixture): ParticipantRow {
  return {
    id: participantIdOf(fixture.index),
    bracketId: bracketIdOf(fixture.bracket),
    participantNo: fixture.participantNo,
    entryRef: entryRefOf(fixture.entry),
    launchId: fixture.launch === null ? null : launchIdOf(fixture.launch),
    productId: fixture.product === null ? null : productIdOf(fixture.product),
    ownerUserId: fixture.owner === null ? null : userIdOf(fixture.owner),
    createdAt: T0,
    updatedAt: T0,
    ...fixture.columns,
  };
}

function bracketMatchRowOf(fixture: BracketMatchFixture): BracketMatchRow {
  return {
    matchId: bracketMatchIdOf(fixture.index),
    bracketId: bracketIdOf(fixture.bracket),
    round: fixture.round,
    position: fixture.position,
    matchDate: '2026-11-24',
    participant1No: fixture.participantNos[0],
    participant2No: fixture.participantNos[1] ?? null,
    status: 'scheduled',
    createdAt: T0,
    updatedAt: T0,
    ...fixture.columns,
  };
}

export async function insertBrackets(
  fixtures: readonly BracketFixture[],
): Promise<void> {
  await insertInChunks(fixtures.map(bracketRowOf), (part) =>
    db.insert(tournamentBrackets).values(part),
  );
}

export async function insertParticipants(
  fixtures: readonly ParticipantFixture[],
): Promise<void> {
  await insertInChunks(fixtures.map(participantRowOf), (part) =>
    db.insert(bracketParticipants).values(part),
  );
}

export async function insertBracketMatches(
  fixtures: readonly BracketMatchFixture[],
): Promise<void> {
  await insertInChunks(fixtures.map(bracketMatchRowOf), (part) =>
    db.insert(bracketMatches).values(part),
  );
}

// 外部キーの参照元から先に消す
export async function clearBracketTables(): Promise<void> {
  await db.delete(bracketMatches);
  await db.delete(bracketParticipants);
  await db.delete(tournamentBrackets);
  await clearMatchTables();
}
