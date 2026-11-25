import { beforeEach, describe, expect, test } from 'vitest';

import { sequentialIdOf } from '../match/testing/event-fixtures.ts';
import {
  insertUser,
  launchIdOf,
  productIdOf,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import {
  bracketMatchIdOf,
  clearBracketTables,
  entryRefOf,
} from './testing/bracket-fixtures.ts';
import {
  BRACKET_ID,
  createProgression,
  DRAW_AT,
  FIRST_ROUND_ADVANCE_AT,
  FIRST_ROUND_DATE,
  FIRST_ROUND_IDS,
  insertPlannedRound,
  POLICY,
  R1_POSITION_1,
  R1_POSITION_2,
  readBracket,
  readBracketMatches,
  readEliminated,
  readEntriesOf,
  readMatchesOfRound,
  SECOND_ROUND_DATE,
  seedBracket,
  settle,
  unlink,
} from './testing/progression-fixtures.ts';

beforeEach(async () => {
  await clearBracketTables();
  await insertUser(1);
});

describe('D1BracketProgression.advance(紐付けを解除した参加者)', () => {
  test('側の一方が紐付けを解除した参加者なら、他方だけの側1つのマッチを作り、解除した参加者をそのラウンドの敗退にする', async () => {
    await seedBracket(6);
    await unlink([4]);

    const result = await createProgression(FIRST_ROUND_IDS).progression.advance(
      BRACKET_ID,
      POLICY,
      DRAW_AT,
    );

    expect(result).toMatchObject({
      kind: 'scheduled',
      round: 1,
      previewMatchIds: [R1_POSITION_2],
    });
    expect(await readBracketMatches()).toEqual([
      expect.objectContaining({
        matchId: R1_POSITION_1,
        participant1No: 3,
        participant2No: null,
        status: 'scheduled',
      }),
      expect.objectContaining({
        matchId: R1_POSITION_2,
        participant1No: 5,
        participant2No: 6,
      }),
    ]);
    expect(await readEntriesOf(R1_POSITION_1)).toEqual([
      {
        slot: 1,
        launchId: launchIdOf(3),
        productId: productIdOf(3),
        ownerUserId: userIdOf(1),
      },
    ]);
    expect((await readEliminated()).get(4)).toBe(1);
  });

  test('両方の側が紐付けを解除した参加者なら、その位置のマッチを作らない', async () => {
    await seedBracket(6);
    await unlink([3, 4]);

    const result = await createProgression(FIRST_ROUND_IDS).progression.advance(
      BRACKET_ID,
      POLICY,
      DRAW_AT,
    );

    expect(result).toMatchObject({
      kind: 'scheduled',
      round: 1,
      previewMatchIds: [sequentialIdOf(FIRST_ROUND_IDS)],
    });
    expect(await readBracketMatches()).toEqual([
      expect.objectContaining({
        position: 2,
        participant1No: 5,
        participant2No: 6,
      }),
    ]);
    const eliminated = await readEliminated();
    expect([eliminated.get(3), eliminated.get(4)]).toEqual([1, 1]);
  });

  test('ラウンドの全ての側が紐付けを解除した参加者なら、そのラウンドを飛ばして次のラウンドを作る', async () => {
    await seedBracket(6);
    await unlink([3, 4, 5, 6]);

    const result = await createProgression(FIRST_ROUND_IDS).progression.advance(
      BRACKET_ID,
      POLICY,
      DRAW_AT,
    );

    expect(result).toEqual({
      kind: 'scheduled',
      bracketId: BRACKET_ID,
      round: 2,
      late: false,
      decidedMatchIds: [],
      previewMatchIds: [],
    });
    expect(await readBracketMatches()).toEqual([
      expect.objectContaining({
        round: 2,
        position: 1,
        matchDate: FIRST_ROUND_DATE,
        participant1No: 1,
        participant2No: null,
      }),
      expect.objectContaining({
        round: 2,
        position: 2,
        matchDate: FIRST_ROUND_DATE,
        participant1No: 2,
        participant2No: null,
      }),
    ]);
    const eliminated = await readEliminated();
    expect([3, 4, 5, 6].map((no) => eliminated.get(no))).toEqual([1, 1, 1, 1]);
  });

  test('次ラウンドに残る参加者が紐付けを解除した参加者を除いて1になると、優勝で終える', async () => {
    await seedBracket(4);
    await createProgression(FIRST_ROUND_IDS).progression.advance(
      BRACKET_ID,
      POLICY,
      DRAW_AT,
    );
    await settle(R1_POSITION_1, ['won', 'lost']);
    await settle(R1_POSITION_2, ['won', 'lost']);
    await unlink([3]);

    const result = await createProgression(101).progression.advance(
      BRACKET_ID,
      POLICY,
      FIRST_ROUND_ADVANCE_AT,
    );

    expect(result).toEqual({
      kind: 'finished',
      bracketId: BRACKET_ID,
      championRef: entryRefOf(1),
      newlyFinished: true,
      decidedMatchIds: [R1_POSITION_1, R1_POSITION_2],
    });
    expect((await readEliminated()).get(3)).toBe(2);
    expect(await readMatchesOfRound(2)).toEqual([]);
  });

  test('予定の作成の前に中断した位置の参加者の紐付けが解除されていれば、側から除いて予定を作る', async () => {
    await seedBracket(6);
    await insertPlannedRound(1, FIRST_ROUND_DATE, [
      { index: 1, position: 1, participantNos: [3, 4] },
      { index: 2, position: 2, participantNos: [5, 6] },
    ]);
    await unlink([4]);

    await createProgression(FIRST_ROUND_IDS).progression.advance(
      BRACKET_ID,
      POLICY,
      DRAW_AT,
    );

    expect(await readBracketMatches()).toEqual([
      expect.objectContaining({
        matchId: bracketMatchIdOf(1),
        participant1No: 3,
        participant2No: null,
        status: 'scheduled',
      }),
      expect.objectContaining({
        matchId: bracketMatchIdOf(2),
        status: 'scheduled',
      }),
    ]);
    expect(
      (await readEntriesOf(bracketMatchIdOf(1))).map(
        ({ launchId }) => launchId,
      ),
    ).toEqual([launchIdOf(3)]);
    expect((await readEliminated()).get(4)).toBe(1);
  });

  test('勝ち残りが1になって終えるとき、その参加者の紐付けが解除されていれば受賞なしで終え、その参加者を敗退にする', async () => {
    await seedBracket(4);
    await createProgression(FIRST_ROUND_IDS).progression.advance(
      BRACKET_ID,
      POLICY,
      DRAW_AT,
    );
    await settle(R1_POSITION_1, ['won', 'lost']);
    await settle(R1_POSITION_2, ['lost', 'lost'], 'no_votes');
    await unlink([1]);

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
      decidedMatchIds: [R1_POSITION_1, R1_POSITION_2],
    });
    expect(await readBracket()).toMatchObject({
      status: 'finished',
      outcome: 'no_award',
      championParticipantNo: null,
    });
    expect((await readEliminated()).get(1)).toBe(2);
  });

  test('シードだけが残って1回戦を飛ばすとき、そのシードの紐付けが解除されていれば受賞なしで終える', async () => {
    await seedBracket(3);
    await unlink([1, 2, 3]);

    const result = await createProgression(FIRST_ROUND_IDS).progression.advance(
      BRACKET_ID,
      POLICY,
      DRAW_AT,
    );

    expect(result).toMatchObject({
      kind: 'finished',
      championRef: null,
      newlyFinished: true,
    });
    expect(await readBracket()).toMatchObject({ outcome: 'no_award' });
    expect(await readBracketMatches()).toEqual([]);
  });

  test('決勝のマッチで確定した勝者は、確定の後に紐付けが解除されても優勝で終える', async () => {
    await seedBracket(2);
    await createProgression(FIRST_ROUND_IDS).progression.advance(
      BRACKET_ID,
      POLICY,
      DRAW_AT,
    );
    await settle(R1_POSITION_1, ['won', 'lost']);
    await unlink([1]);

    const result = await createProgression(101).progression.advance(
      BRACKET_ID,
      POLICY,
      FIRST_ROUND_ADVANCE_AT,
    );

    expect(result).toEqual({
      kind: 'finished',
      bracketId: BRACKET_ID,
      championRef: entryRefOf(1),
      newlyFinished: true,
      decidedMatchIds: [R1_POSITION_1],
    });
    expect(await readBracket()).toMatchObject({
      outcome: 'champion',
      championParticipantNo: 1,
    });
  });

  test('終えるときに予定の作成の前に中断した位置が残っていれば消す', async () => {
    await seedBracket(4);
    await createProgression(FIRST_ROUND_IDS).progression.advance(
      BRACKET_ID,
      POLICY,
      DRAW_AT,
    );
    await settle(R1_POSITION_1, ['won', 'lost']);
    await settle(R1_POSITION_2, ['won', 'lost']);
    await insertPlannedRound(2, SECOND_ROUND_DATE, [
      { index: 21, position: 1, participantNos: [1, 3] },
    ]);
    await unlink([3]);

    const result = await createProgression(101).progression.advance(
      BRACKET_ID,
      POLICY,
      FIRST_ROUND_ADVANCE_AT,
    );

    expect(result).toMatchObject({
      kind: 'finished',
      championRef: entryRefOf(1),
      newlyFinished: true,
    });
    expect(await readBracketMatches(2)).toEqual([]);
  });
});
