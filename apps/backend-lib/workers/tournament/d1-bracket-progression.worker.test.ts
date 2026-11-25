import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { matchEntries } from '../../../db/schema/match/match-entries.ts';
import { matches } from '../../../db/schema/match/matches.ts';
import {
  createRecordingDatabase,
  expectSplitWithinBindLimit,
} from '../identity/testing/identity-store-fixtures.ts';
import { sequentialIdOf } from '../match/testing/event-fixtures.ts';
import {
  db,
  insertUser,
  launchIdOf,
  productIdOf,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import { clearBracketTables } from './testing/bracket-fixtures.ts';
import {
  BRACKET_ID,
  createProgression,
  DRAW_AT,
  FIRST_ROUND_ADVANCE_AT,
  FIRST_ROUND_DATE,
  FIRST_ROUND_DECIDED_AT,
  FIRST_ROUND_IDS,
  LATE_SECOND_ROUND_DATE,
  POLICY,
  R1_POSITION_1,
  R1_POSITION_2,
  readBracketMatches,
  readEliminated,
  readEntriesOf,
  readMatchesOfRound,
  readScheduledEventMatchIds,
  scheduleFirstRoundOfSix,
  SECOND_ROUND_DATE,
  seedBracket,
  settle,
  windowOf,
  at,
} from './testing/progression-fixtures.ts';

beforeEach(async () => {
  await clearBracketTables();
  await insertUser(1);
});

describe('D1BracketProgression.advance(予定の作成)', () => {
  test('記録が無ければ1回戦の位置とマッチの予定を作り、側2つのマッチを予告に含める', async () => {
    await seedBracket(6);
    const { progression } = createProgression(FIRST_ROUND_IDS);

    const result = await progression.advance(BRACKET_ID, POLICY, DRAW_AT);

    expect(result).toEqual({
      kind: 'scheduled',
      bracketId: BRACKET_ID,
      round: 1,
      late: false,
      decidedMatchIds: [],
      previewMatchIds: [R1_POSITION_1, R1_POSITION_2],
    });
    expect(await readBracketMatches()).toEqual([
      {
        matchId: R1_POSITION_1,
        round: 1,
        position: 1,
        matchDate: FIRST_ROUND_DATE,
        participant1No: 3,
        participant2No: 4,
        status: 'scheduled',
        winnerParticipantNo: null,
        decidedAt: null,
      },
      {
        matchId: R1_POSITION_2,
        round: 1,
        position: 2,
        matchDate: FIRST_ROUND_DATE,
        participant1No: 5,
        participant2No: 6,
        status: 'scheduled',
        winnerParticipantNo: null,
        decidedAt: null,
      },
    ]);
    const window = windowOf(FIRST_ROUND_DATE);
    expect(await readMatchesOfRound(1)).toEqual(
      [R1_POSITION_1, R1_POSITION_2].map((id) => ({
        id,
        kind: 'week',
        round: 1,
        stage: null,
        matchDate: FIRST_ROUND_DATE,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
      })),
    );
    expect(await readEntriesOf(R1_POSITION_1)).toEqual(
      [3, 4].map((index, position) => ({
        slot: position + 1,
        launchId: launchIdOf(index),
        productId: productIdOf(index),
        ownerUserId: userIdOf(1),
      })),
    );
  });

  test('種類がYearのブラケットはYearのマッチとして段階を付けて予定する', async () => {
    await seedBracket(2, 'year');
    const { progression } = createProgression(FIRST_ROUND_IDS);

    await progression.advance(BRACKET_ID, POLICY, DRAW_AT);

    expect(await readMatchesOfRound(1)).toEqual([
      expect.objectContaining({
        id: R1_POSITION_1,
        kind: 'year',
        round: 1,
        stage: 'final',
      }),
    ]);
  });
});

describe('D1BracketProgression.advance(結果の写しと次ラウンド)', () => {
  beforeEach(scheduleFirstRoundOfSix);

  test('確定した勝者を写して敗者の敗退を記録し、次ラウンドの位置とマッチの予定を作る', async () => {
    await settle(R1_POSITION_1, ['won', 'lost']);
    await settle(R1_POSITION_2, ['lost', 'won']);
    const { progression } = createProgression(101);

    const result = await progression.advance(
      BRACKET_ID,
      POLICY,
      FIRST_ROUND_ADVANCE_AT,
    );

    const secondRound = [sequentialIdOf(101), sequentialIdOf(102)];
    expect(result).toEqual({
      kind: 'scheduled',
      bracketId: BRACKET_ID,
      round: 2,
      late: false,
      decidedMatchIds: [R1_POSITION_1, R1_POSITION_2],
      previewMatchIds: secondRound,
    });
    expect(await readBracketMatches(1)).toEqual([
      expect.objectContaining({
        matchId: R1_POSITION_1,
        status: 'decided',
        winnerParticipantNo: 3,
        decidedAt: FIRST_ROUND_DECIDED_AT,
      }),
      expect.objectContaining({
        matchId: R1_POSITION_2,
        status: 'decided',
        winnerParticipantNo: 6,
        decidedAt: FIRST_ROUND_DECIDED_AT,
      }),
    ]);
    expect(await readEliminated()).toEqual(
      new Map([
        [1, null],
        [2, null],
        [3, null],
        [4, 1],
        [5, 1],
        [6, null],
      ]),
    );
    expect(await readBracketMatches(2)).toEqual([
      {
        matchId: secondRound[0],
        round: 2,
        position: 1,
        matchDate: SECOND_ROUND_DATE,
        participant1No: 1,
        participant2No: 6,
        status: 'scheduled',
        winnerParticipantNo: null,
        decidedAt: null,
      },
      {
        matchId: secondRound[1],
        round: 2,
        position: 2,
        matchDate: SECOND_ROUND_DATE,
        participant1No: 2,
        participant2No: 3,
        status: 'scheduled',
        winnerParticipantNo: null,
        decidedAt: null,
      },
    ]);
    const window = windowOf(SECOND_ROUND_DATE);
    expect(await readMatchesOfRound(2)).toEqual(
      secondRound.map((id) => ({
        id,
        kind: 'week',
        round: 2,
        stage: 'semifinal',
        matchDate: SECOND_ROUND_DATE,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
      })),
    );
    expect(await readEntriesOf(secondRound[0] ?? '')).toEqual(
      [1, 6].map((index, position) => ({
        slot: position + 1,
        launchId: launchIdOf(index),
        productId: productIdOf(index),
        ownerUserId: userIdOf(1),
      })),
    );
  });

  test('隣のマッチが両者敗北なら他方だけの側1つのマッチを作り、予告からは除く', async () => {
    await settle(R1_POSITION_1, ['lost', 'lost'], 'no_votes');
    await settle(R1_POSITION_2, ['lost', 'won']);
    const { progression } = createProgression(101);

    const result = await progression.advance(
      BRACKET_ID,
      POLICY,
      FIRST_ROUND_ADVANCE_AT,
    );

    expect(result).toMatchObject({
      kind: 'scheduled',
      round: 2,
      previewMatchIds: [sequentialIdOf(101)],
    });
    expect(await readBracketMatches(1)).toEqual([
      expect.objectContaining({ status: 'decided', winnerParticipantNo: null }),
      expect.objectContaining({ status: 'decided', winnerParticipantNo: 6 }),
    ]);
    expect(await readBracketMatches(2)).toEqual([
      expect.objectContaining({
        position: 1,
        participant1No: 1,
        participant2No: 6,
      }),
      expect.objectContaining({
        matchId: sequentialIdOf(102),
        position: 2,
        participant1No: 2,
        participant2No: null,
        status: 'scheduled',
      }),
    ]);
    expect(await readEntriesOf(sequentialIdOf(102))).toEqual([
      {
        slot: 1,
        launchId: launchIdOf(2),
        productId: productIdOf(2),
        ownerUserId: userIdOf(1),
      },
    ]);
    expect(await readEliminated()).toEqual(
      new Map([
        [1, null],
        [2, null],
        [3, 1],
        [4, 1],
        [5, 1],
        [6, null],
      ]),
    );
  });

  test('未確定のマッチがあれば確定した分だけを写して待ち、次ラウンドを作らない', async () => {
    await settle(R1_POSITION_1, ['won', 'lost']);
    const { progression } = createProgression(101);

    const result = await progression.advance(
      BRACKET_ID,
      POLICY,
      FIRST_ROUND_ADVANCE_AT,
    );

    expect(result).toEqual({
      kind: 'waiting',
      bracketId: BRACKET_ID,
      decidedMatchIds: [R1_POSITION_1],
      previewMatchIds: [],
    });
    expect(await readBracketMatches()).toEqual([
      expect.objectContaining({ status: 'decided', winnerParticipantNo: 3 }),
      expect.objectContaining({
        status: 'scheduled',
        winnerParticipantNo: null,
      }),
    ]);
    expect((await readEliminated()).get(4)).toBe(1);
    expect(await readMatchesOfRound(2)).toEqual([]);
  });

  test('0:00を過ぎてから次ラウンドを作ると実施日を1日遅らせ、遅れとして返す', async () => {
    await settle(R1_POSITION_1, ['won', 'lost']);
    await settle(R1_POSITION_2, ['lost', 'won']);
    const { progression } = createProgression(101);

    const result = await progression.advance(
      BRACKET_ID,
      POLICY,
      at('2026-11-25', 0, 10),
    );

    expect(result).toMatchObject({ kind: 'scheduled', round: 2, late: true });
    expect(await readBracketMatches(2)).toEqual([
      expect.objectContaining({ matchDate: LATE_SECOND_ROUND_DATE }),
      expect.objectContaining({ matchDate: LATE_SECOND_ROUND_DATE }),
    ]);
  });
});

describe('D1BracketProgression.advance(冪等性)', () => {
  beforeEach(async () => {
    await scheduleFirstRoundOfSix();
    await settle(R1_POSITION_1, ['won', 'lost']);
    await settle(R1_POSITION_2, ['lost', 'won']);
  });

  test('2回続けて進めても次ラウンドのマッチは1組で、2回目は同じ結果を返す', async () => {
    const first = await createProgression(101).progression.advance(
      BRACKET_ID,
      POLICY,
      FIRST_ROUND_ADVANCE_AT,
    );
    const second = await createProgression(201).progression.advance(
      BRACKET_ID,
      POLICY,
      FIRST_ROUND_ADVANCE_AT,
    );

    const secondRound = [sequentialIdOf(101), sequentialIdOf(102)];
    expect(second).toEqual(first);
    expect((await readBracketMatches(2)).map(({ matchId }) => matchId)).toEqual(
      secondRound,
    );
    expect((await readMatchesOfRound(2)).map(({ id }) => id)).toEqual(
      secondRound,
    );
    expect(await readScheduledEventMatchIds()).toEqual([
      R1_POSITION_1,
      R1_POSITION_2,
      ...secondRound,
    ]);
    expect(await readEliminated()).toEqual(
      new Map([
        [1, null],
        [2, null],
        [3, null],
        [4, 1],
        [5, 1],
        [6, null],
      ]),
    );
  });

  test('同時に進めても次ラウンドのマッチは1組で、先に挿入した側のマッチIDにそろう', async () => {
    const [first, second] = await Promise.all([
      createProgression(101).progression.advance(
        BRACKET_ID,
        POLICY,
        FIRST_ROUND_ADVANCE_AT,
      ),
      createProgression(201).progression.advance(
        BRACKET_ID,
        POLICY,
        FIRST_ROUND_ADVANCE_AT,
      ),
    ]);

    const recorded = (await readBracketMatches(2)).map(
      ({ matchId }) => matchId,
    );
    expect([
      [sequentialIdOf(101), sequentialIdOf(102)],
      [sequentialIdOf(201), sequentialIdOf(202)],
    ]).toContainEqual(recorded);
    expect((await readMatchesOfRound(2)).map(({ id }) => id)).toEqual(recorded);
    expect(await readScheduledEventMatchIds()).toEqual([
      R1_POSITION_1,
      R1_POSITION_2,
      ...recorded,
    ]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ previewMatchIds: recorded });
  });
});

describe('D1BracketProgression.advance(分割)', () => {
  test('参加200でも位置の挿入・予定・結果の写しを上限に収まる単位に分けて書き込む', async () => {
    await seedBracket(200);
    const recording = createRecordingDatabase();
    const { progression, scheduler } = createProgression(
      FIRST_ROUND_IDS,
      recording.database,
    );

    const firstRound = await progression.advance(BRACKET_ID, POLICY, DRAW_AT);
    await db
      .update(matches)
      .set({ decidedAt: FIRST_ROUND_DECIDED_AT, decision: 'votes' })
      .where(eq(matches.round, 1));
    await db
      .update(matchEntries)
      .set({ result: 'won' })
      .where(eq(matchEntries.slot, 1));
    await db
      .update(matchEntries)
      .set({ result: 'lost' })
      .where(eq(matchEntries.slot, 2));
    const secondRound = await progression.advance(
      BRACKET_ID,
      POLICY,
      FIRST_ROUND_ADVANCE_AT,
    );

    expect(firstRound).toMatchObject({ kind: 'scheduled', round: 1 });
    expect(secondRound).toMatchObject({ kind: 'scheduled', round: 2 });
    if (secondRound.kind !== 'scheduled') {
      throw new Error('2回戦を予定していません');
    }
    expect(secondRound.decidedMatchIds).toHaveLength(72);
    expect(secondRound.previewMatchIds).toHaveLength(64);
    expect(scheduler.sizes).toEqual([50, 22, 50, 14]);
    const recorded = await readBracketMatches();
    expect(
      recorded.filter(
        ({ round, status }) => round === 1 && status === 'decided',
      ),
    ).toHaveLength(72);
    expect(
      recorded.filter(
        ({ round, status }) => round === 2 && status === 'scheduled',
      ),
    ).toHaveLength(64);
    expect(await readMatchesOfRound(2)).toHaveLength(64);
    const eliminated = [...(await readEliminated()).values()].filter(
      (round) => round === 1,
    );
    expect(eliminated).toHaveLength(72);
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });
});
