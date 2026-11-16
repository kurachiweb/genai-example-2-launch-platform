import { beforeEach, describe, expect, test } from 'vitest';

import { insertUser } from '../product/testing/product-fixtures.ts';
import {
  clearBracketTables,
  entryRefOf,
  insertBrackets,
} from './testing/bracket-fixtures.ts';
import {
  at,
  BRACKET_ID,
  createProgression,
  DRAW_AT,
  FIRST_ROUND_ADVANCE_AT,
  FIRST_ROUND_IDS,
  POLICY,
  R1_POSITION_1,
  R1_POSITION_2,
  readBracket,
  readBracketMatches,
  readEliminated,
  readMatchesOfRound,
  seedBracket,
  settle,
} from './testing/progression-fixtures.ts';

beforeEach(async () => {
  await clearBracketTables();
  await insertUser(1);
});

describe('D1BracketProgression.advance(終了の確定)', () => {
  test('決勝の勝者が確定すると優勝で終え、終了を確定した呼び出しだけがnewlyFinishedになる', async () => {
    await seedBracket(2);
    await createProgression(FIRST_ROUND_IDS).progression.advance(
      BRACKET_ID,
      POLICY,
      DRAW_AT,
    );
    await settle(R1_POSITION_1, ['lost', 'won']);

    const first = await createProgression(101).progression.advance(
      BRACKET_ID,
      POLICY,
      FIRST_ROUND_ADVANCE_AT,
    );
    const second = await createProgression(201).progression.advance(
      BRACKET_ID,
      POLICY,
      at('2026-11-25', 0, 0),
    );

    const finished = {
      kind: 'finished',
      bracketId: BRACKET_ID,
      championRef: entryRefOf(2),
      decidedMatchIds: [R1_POSITION_1],
    };
    expect(first).toEqual({ ...finished, newlyFinished: true });
    expect(second).toEqual({ ...finished, newlyFinished: false });
    expect(await readBracket()).toEqual({
      status: 'finished',
      outcome: 'champion',
      championParticipantNo: 2,
      finishedAt: FIRST_ROUND_ADVANCE_AT,
    });
    expect((await readEliminated()).get(1)).toBe(1);
  });

  test('同時に終了を確定しても、newlyFinishedになるのは1回だけ', async () => {
    await seedBracket(2);
    await createProgression(FIRST_ROUND_IDS).progression.advance(
      BRACKET_ID,
      POLICY,
      DRAW_AT,
    );
    await settle(R1_POSITION_1, ['won', 'lost']);

    const results = await Promise.all(
      [101, 201, 301].map((start) =>
        createProgression(start).progression.advance(
          BRACKET_ID,
          POLICY,
          FIRST_ROUND_ADVANCE_AT,
        ),
      ),
    );

    expect(
      results.map((result) =>
        result.kind === 'finished' ? result.newlyFinished : result.kind,
      ),
    ).toEqual(expect.arrayContaining([true, false, false]));
    expect(
      results.filter(
        (result) => result.kind === 'finished' && result.newlyFinished,
      ),
    ).toHaveLength(1);
    expect(
      results.every(
        (result) =>
          result.kind === 'finished' && result.championRef === entryRefOf(1),
      ),
    ).toBe(true);
  });

  test('決勝が両者敗北なら受賞なしで終える', async () => {
    await seedBracket(2);
    await createProgression(FIRST_ROUND_IDS).progression.advance(
      BRACKET_ID,
      POLICY,
      DRAW_AT,
    );
    await settle(R1_POSITION_1, ['lost', 'lost'], 'no_votes');

    const result = await createProgression(101).progression.advance(
      BRACKET_ID,
      POLICY,
      FIRST_ROUND_ADVANCE_AT,
    );

    expect(result).toEqual({
      kind: 'finished',
      bracketId: BRACKET_ID,
      championRef: null,
      newlyFinished: true,
      decidedMatchIds: [R1_POSITION_1],
    });
    expect(await readBracket()).toEqual({
      status: 'finished',
      outcome: 'no_award',
      championParticipantNo: null,
      finishedAt: FIRST_ROUND_ADVANCE_AT,
    });
  });

  test('次ラウンドに残る参加者が1になると、そのラウンドを行わずに優勝で終える', async () => {
    await seedBracket(4);
    await createProgression(FIRST_ROUND_IDS).progression.advance(
      BRACKET_ID,
      POLICY,
      DRAW_AT,
    );
    await settle(R1_POSITION_1, ['lost', 'lost'], 'no_votes');
    await settle(R1_POSITION_2, ['won', 'lost']);

    const result = await createProgression(101).progression.advance(
      BRACKET_ID,
      POLICY,
      FIRST_ROUND_ADVANCE_AT,
    );

    expect(result).toEqual({
      kind: 'finished',
      bracketId: BRACKET_ID,
      championRef: entryRefOf(3),
      newlyFinished: true,
      decidedMatchIds: [R1_POSITION_1, R1_POSITION_2],
    });
    expect(await readBracket()).toMatchObject({
      outcome: 'champion',
      championParticipantNo: 3,
    });
    expect(await readMatchesOfRound(2)).toEqual([]);
  });

  test('参加1なら予定を作らずに優勝で終え、参加0なら受賞なしで終える', async () => {
    await seedBracket(1);

    const single = await createProgression(FIRST_ROUND_IDS).progression.advance(
      BRACKET_ID,
      POLICY,
      DRAW_AT,
    );

    expect(single).toEqual({
      kind: 'finished',
      bracketId: BRACKET_ID,
      championRef: entryRefOf(1),
      newlyFinished: true,
      decidedMatchIds: [],
    });
    expect(await readBracketMatches()).toEqual([]);

    await clearBracketTables();
    await insertBrackets([{ index: 1, participantCount: 0 }]);

    const empty = await createProgression(FIRST_ROUND_IDS).progression.advance(
      BRACKET_ID,
      POLICY,
      DRAW_AT,
    );

    expect(empty).toEqual({
      kind: 'finished',
      bracketId: BRACKET_ID,
      championRef: null,
      newlyFinished: true,
      decidedMatchIds: [],
    });
    expect(await readBracket()).toMatchObject({ outcome: 'no_award' });
  });
});
