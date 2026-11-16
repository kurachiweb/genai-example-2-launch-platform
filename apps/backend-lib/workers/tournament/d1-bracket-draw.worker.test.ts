import { and, asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import type { Database } from '../../../db/client.ts';
import { matches } from '../../../db/schema/match/matches.ts';
import { bracketMatches } from '../../../db/schema/tournament/bracket-matches.ts';
import { bracketParticipants } from '../../../db/schema/tournament/bracket-participants.ts';
import { tournamentBrackets } from '../../../db/schema/tournament/tournament-brackets.ts';
import type {
  BracketDrawCandidate,
  BracketKind,
} from '../../core/tournament/ports.ts';
import type { DrawOrder } from '../../core/tournament/bracket-draw-rules.ts';
import {
  createRecordingDatabase,
  expectSplitWithinBindLimit,
} from '../identity/testing/identity-store-fixtures.ts';
import { sequentialIdOf } from '../match/testing/event-fixtures.ts';
import {
  db,
  insertLaunches,
  insertProduct,
  insertUsers,
  launchIdOf,
  productIdOf,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import { D1BracketDraw } from './d1-bracket-draw.ts';
import {
  bracketIdOf,
  clearBracketTables,
  entryRefOf,
  insertBrackets,
  insertParticipants,
  tournamentIdOf,
} from './testing/bracket-fixtures.ts';
import {
  createProgression,
  DRAW_AT,
  FIRST_ROUND_ADVANCE_AT,
  FIRST_ROUND_DATE,
  FIRST_ROUND_IDS,
  POLICY,
  readEntriesOf,
  SECOND_ROUND_DATE,
  settle,
  windowOf,
} from './testing/progression-fixtures.ts';

interface OrderingKey {
  readonly votes: number;
  readonly launchOrder: number;
}

const TOURNAMENT_ID = tournamentIdOf(1);

// シードは得票の多い順、非シードはローンチの早い順に並べる
const ORDER: DrawOrder<OrderingKey> = {
  seed: (a, b) => b.votes - a.votes,
  nonSeed: (a, b) => a.launchOrder - b.launchOrder,
};

function ownerOf(index: number): number {
  return (index % 2) + 1;
}

function candidateOf(
  index: number,
  votes: number,
  launchOrder: number,
): BracketDrawCandidate<OrderingKey> {
  return {
    ref: entryRefOf(index),
    tieBreaker: launchIdOf(index),
    value: { votes, launchOrder },
    participant: {
      ref: entryRefOf(index),
      tieBreaker: launchIdOf(index),
      launchId: launchIdOf(index),
      productId: productIdOf(index),
      ownerUserId: userIdOf(ownerOf(index)),
    },
  };
}

// 抽選番号はシードが5・2、非シードが4・3・1・6の順になり、1回戦は4×3と1×6になる
const SIX_CANDIDATES = [
  candidateOf(1, 10, 4),
  candidateOf(2, 50, 1),
  candidateOf(3, 20, 3),
  candidateOf(4, 30, 2),
  candidateOf(5, 60, 6),
  candidateOf(6, 5, 5),
] as const;

const SIX_DRAWN = [5, 2, 4, 3, 1, 6] as const;

function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

async function seedLaunches(count: number): Promise<void> {
  for (const index of range(count)) {
    await insertProduct(index, ownerOf(index));
  }
  await insertLaunches(
    range(count).map((index) => ({ index, productIndex: index })),
  );
}

function createDraw(
  idStart: number,
  database: Database = db,
): {
  draw: D1BracketDraw;
  scheduler: ReturnType<typeof createProgression>['scheduler'];
} {
  const { progression, scheduler } = createProgression(idStart, database);
  return { draw: new D1BracketDraw(database, progression), scheduler };
}

function createInput(
  candidates: readonly BracketDrawCandidate<OrderingKey>[],
  now: Date = DRAW_AT,
  kind: BracketKind = 'week',
) {
  return {
    kind,
    tournamentId: TOURNAMENT_ID,
    candidates,
    order: ORDER,
    policy: POLICY,
    now,
  };
}

async function readBrackets() {
  return db
    .select({
      id: tournamentBrackets.id,
      kind: tournamentBrackets.kind,
      tournamentId: tournamentBrackets.tournamentId,
      participantCount: tournamentBrackets.participantCount,
      seedCount: tournamentBrackets.seedCount,
      secondRoundSize: tournamentBrackets.secondRoundSize,
      roundCount: tournamentBrackets.roundCount,
      firstRoundDate: tournamentBrackets.firstRoundDate,
      status: tournamentBrackets.status,
      outcome: tournamentBrackets.outcome,
      championParticipantNo: tournamentBrackets.championParticipantNo,
    })
    .from(tournamentBrackets)
    .orderBy(asc(tournamentBrackets.kind));
}

async function readParticipants(bracketId: string) {
  return db
    .select({
      participantNo: bracketParticipants.participantNo,
      entryRef: bracketParticipants.entryRef,
      launchId: bracketParticipants.launchId,
      productId: bracketParticipants.productId,
      ownerUserId: bracketParticipants.ownerUserId,
      eliminatedRound: bracketParticipants.eliminatedRound,
    })
    .from(bracketParticipants)
    .where(eq(bracketParticipants.bracketId, bracketId))
    .orderBy(asc(bracketParticipants.participantNo));
}

async function readPositions(bracketId: string, round?: number) {
  return db
    .select({
      matchId: bracketMatches.matchId,
      round: bracketMatches.round,
      position: bracketMatches.position,
      matchDate: bracketMatches.matchDate,
      participant1No: bracketMatches.participant1No,
      participant2No: bracketMatches.participant2No,
      status: bracketMatches.status,
    })
    .from(bracketMatches)
    .where(
      round === undefined
        ? eq(bracketMatches.bracketId, bracketId)
        : and(
            eq(bracketMatches.bracketId, bracketId),
            eq(bracketMatches.round, round),
          ),
    )
    .orderBy(asc(bracketMatches.round), asc(bracketMatches.position));
}

async function countMatches(): Promise<number> {
  return (await db.select({ id: matches.id }).from(matches)).length;
}

function participantRowOf(participantNo: number, index: number) {
  return {
    participantNo,
    entryRef: entryRefOf(index),
    launchId: launchIdOf(index),
    productId: productIdOf(index),
    ownerUserId: userIdOf(ownerOf(index)),
    eliminatedRound: null,
  };
}

beforeEach(async () => {
  await clearBracketTables();
  await insertUsers([1, 2]);
});

describe('D1BracketDraw.create(組み合わせの作成)', () => {
  test('候補を並べた順に参加者の番号を記録し、1回戦の位置とマッチの予定を作る', async () => {
    await seedLaunches(6);
    const { draw } = createDraw(FIRST_ROUND_IDS);

    const result = await draw.create(createInput(SIX_CANDIDATES));

    const [bracket] = await readBrackets();
    expect(bracket).toEqual({
      id: result.bracketId,
      kind: 'week',
      tournamentId: TOURNAMENT_ID,
      participantCount: 6,
      seedCount: 2,
      secondRoundSize: 4,
      roundCount: 3,
      firstRoundDate: FIRST_ROUND_DATE,
      status: 'active',
      outcome: null,
      championParticipantNo: null,
    });
    expect(await readParticipants(result.bracketId)).toEqual(
      SIX_DRAWN.map((index, offset) => participantRowOf(offset + 1, index)),
    );
    const firstRound = [sequentialIdOf(1), sequentialIdOf(2)];
    expect(result).toEqual({
      kind: 'scheduled',
      bracketId: result.bracketId,
      round: 1,
      late: false,
      decidedMatchIds: [],
      previewMatchIds: firstRound,
    });
    expect(await readPositions(result.bracketId)).toEqual([
      {
        matchId: firstRound[0],
        round: 1,
        position: 1,
        matchDate: FIRST_ROUND_DATE,
        participant1No: 3,
        participant2No: 4,
        status: 'scheduled',
      },
      {
        matchId: firstRound[1],
        round: 1,
        position: 2,
        matchDate: FIRST_ROUND_DATE,
        participant1No: 5,
        participant2No: 6,
        status: 'scheduled',
      },
    ]);
    expect(await readEntriesOf(sequentialIdOf(1))).toEqual(
      [4, 3].map((index, offset) => ({
        slot: offset + 1,
        launchId: launchIdOf(index),
        productId: productIdOf(index),
        ownerUserId: userIdOf(ownerOf(index)),
      })),
    );
  });

  test('参加0ならマッチを作らずに受賞なしで終える', async () => {
    const { draw, scheduler } = createDraw(FIRST_ROUND_IDS);

    const result = await draw.create(createInput([]));

    expect(result).toEqual({
      kind: 'finished',
      bracketId: result.bracketId,
      championRef: null,
      newlyFinished: true,
      decidedMatchIds: [],
    });
    expect(await readBrackets()).toEqual([
      expect.objectContaining({
        id: result.bracketId,
        participantCount: 0,
        roundCount: 0,
        firstRoundDate: null,
        status: 'finished',
        outcome: 'no_award',
        championParticipantNo: null,
      }),
    ]);
    expect(await readParticipants(result.bracketId)).toEqual([]);
    expect(await readPositions(result.bracketId)).toEqual([]);
    expect(scheduler.sizes).toEqual([]);
    expect(await countMatches()).toBe(0);
  });

  test('参加1ならマッチを作らずにその参加者を優勝として終える', async () => {
    await seedLaunches(1);
    const { draw, scheduler } = createDraw(FIRST_ROUND_IDS);

    const result = await draw.create(createInput([candidateOf(1, 0, 1)]));

    expect(result).toEqual({
      kind: 'finished',
      bracketId: result.bracketId,
      championRef: entryRefOf(1),
      newlyFinished: true,
      decidedMatchIds: [],
    });
    expect(await readBrackets()).toEqual([
      expect.objectContaining({
        participantCount: 1,
        roundCount: 0,
        firstRoundDate: null,
        status: 'finished',
        outcome: 'champion',
        championParticipantNo: 1,
      }),
    ]);
    expect(await readParticipants(result.bracketId)).toEqual([
      participantRowOf(1, 1),
    ]);
    expect(await readPositions(result.bracketId)).toEqual([]);
    expect(scheduler.sizes).toEqual([]);
    expect(await countMatches()).toBe(0);
  });

  test('参加2なら1回戦の日に決勝だけを予定する', async () => {
    await seedLaunches(2);
    const { draw } = createDraw(FIRST_ROUND_IDS);

    const result = await draw.create(
      createInput([candidateOf(1, 3, 1), candidateOf(2, 5, 2)]),
    );

    expect(result).toEqual({
      kind: 'scheduled',
      bracketId: result.bracketId,
      round: 1,
      late: false,
      decidedMatchIds: [],
      previewMatchIds: [sequentialIdOf(1)],
    });
    expect(await readPositions(result.bracketId)).toEqual([
      {
        matchId: sequentialIdOf(1),
        round: 1,
        position: 1,
        matchDate: FIRST_ROUND_DATE,
        participant1No: 1,
        participant2No: 2,
        status: 'scheduled',
      },
    ]);
    const window = windowOf(FIRST_ROUND_DATE);
    expect(
      await db
        .select({
          id: matches.id,
          kind: matches.kind,
          round: matches.round,
          stage: matches.stage,
          matchDate: matches.matchDate,
          startsAt: matches.startsAt,
          endsAt: matches.endsAt,
        })
        .from(matches),
    ).toEqual([
      {
        id: sequentialIdOf(1),
        kind: 'week',
        round: 1,
        stage: 'final',
        matchDate: FIRST_ROUND_DATE,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
      },
    ]);
  });

  test('同じトーナメントの識別子でも種類が違えば別のブラケットとして記録する', async () => {
    await seedLaunches(2);
    const candidates = [candidateOf(1, 3, 1), candidateOf(2, 5, 2)];

    const week = await createDraw(FIRST_ROUND_IDS).draw.create(
      createInput(candidates),
    );
    const year = await createDraw(101).draw.create(
      createInput(candidates, DRAW_AT, 'year'),
    );

    expect(week.bracketId).not.toBe(year.bracketId);
    expect(
      (await readBrackets()).map(({ id, kind, tournamentId }) => ({
        id,
        kind,
        tournamentId,
      })),
    ).toEqual([
      { id: week.bracketId, kind: 'week', tournamentId: TOURNAMENT_ID },
      { id: year.bracketId, kind: 'year', tournamentId: TOURNAMENT_ID },
    ]);
  });
});

describe('D1BracketDraw.create(再実行)', () => {
  test('同じ候補で再実行しても記録を重ねず、予定済みの1回戦と同じ結果を返す', async () => {
    await seedLaunches(6);
    const first = await createDraw(FIRST_ROUND_IDS).draw.create(
      createInput(SIX_CANDIDATES),
    );
    const positions = await readPositions(first.bracketId);
    const { draw, scheduler } = createDraw(101);

    const second = await draw.create(
      createInput([...SIX_CANDIDATES].reverse()),
    );

    expect(second).toEqual(first);
    expect(await readBrackets()).toHaveLength(1);
    expect(await readParticipants(first.bracketId)).toEqual(
      SIX_DRAWN.map((index, offset) => participantRowOf(offset + 1, index)),
    );
    expect(await readPositions(first.bracketId)).toEqual(positions);
    expect(scheduler.sizes).toEqual([]);
    expect(await countMatches()).toBe(2);
  });

  test('参加者の記録の途中で中断したブラケットは、残りの参加者を記録して1回戦を予定する', async () => {
    await seedLaunches(6);
    await insertBrackets([
      {
        index: 1,
        participantCount: 6,
        columns: { firstRoundDate: FIRST_ROUND_DATE },
      },
    ]);
    await insertParticipants(
      SIX_DRAWN.slice(0, 3).map((index, offset) => ({
        index: offset + 1,
        bracket: 1,
        participantNo: offset + 1,
        entry: index,
        launch: index,
        product: index,
        owner: ownerOf(index),
      })),
    );
    const { draw } = createDraw(FIRST_ROUND_IDS);

    const result = await draw.create(createInput(SIX_CANDIDATES));

    expect(result).toMatchObject({
      kind: 'scheduled',
      bracketId: bracketIdOf(1),
      round: 1,
      previewMatchIds: [sequentialIdOf(1), sequentialIdOf(2)],
    });
    expect(await readBrackets()).toHaveLength(1);
    expect(await readParticipants(bracketIdOf(1))).toEqual(
      SIX_DRAWN.map((index, offset) => participantRowOf(offset + 1, index)),
    );
  });

  test('1回戦が確定した後の再実行は、記録を重ねずに次のラウンドを予定する', async () => {
    await seedLaunches(6);
    const first = await createDraw(FIRST_ROUND_IDS).draw.create(
      createInput(SIX_CANDIDATES),
    );
    await settle(sequentialIdOf(1), ['won', 'lost']);
    await settle(sequentialIdOf(2), ['lost', 'won']);

    const second = await createDraw(101).draw.create(
      createInput(SIX_CANDIDATES, FIRST_ROUND_ADVANCE_AT),
    );

    expect(second).toEqual({
      kind: 'scheduled',
      bracketId: first.bracketId,
      round: 2,
      late: false,
      decidedMatchIds: [sequentialIdOf(1), sequentialIdOf(2)],
      previewMatchIds: [sequentialIdOf(101), sequentialIdOf(102)],
    });
    expect(await readBrackets()).toHaveLength(1);
    expect(await readParticipants(first.bracketId)).toHaveLength(6);
    expect(await readPositions(first.bracketId, 2)).toEqual([
      expect.objectContaining({
        position: 1,
        matchDate: SECOND_ROUND_DATE,
        participant1No: 1,
        participant2No: 6,
      }),
      expect.objectContaining({
        position: 2,
        matchDate: SECOND_ROUND_DATE,
        participant1No: 2,
        participant2No: 3,
      }),
    ]);
  });
});

describe('D1BracketDraw.create(分割)', () => {
  test('参加120でも参加者の記録を上限に収まる単位に分けて書き込む', async () => {
    const count = 120;
    await seedLaunches(count);
    const candidates = range(count).map((index) =>
      candidateOf(index, count - index, index),
    );
    const recording = createRecordingDatabase();

    const result = await createDraw(
      FIRST_ROUND_IDS,
      recording.database,
    ).draw.create(createInput(candidates));

    expect(result).toMatchObject({ kind: 'scheduled', round: 1 });
    expect(await readParticipants(result.bracketId)).toHaveLength(count);
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });
});
