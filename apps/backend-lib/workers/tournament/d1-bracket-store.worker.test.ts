import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { users } from '../../../db/schema/identity/users.ts';
import { productLaunches } from '../../../db/schema/product/product-launches.ts';
import { products } from '../../../db/schema/product/products.ts';
import { bracketParticipants } from '../../../db/schema/tournament/bracket-participants.ts';
import { bracketShape } from '../../core/tournament/bracket-shape.ts';
import {
  createRecordingDatabase,
  expectSplitWithinBindLimit,
  expectWithinBindLimit,
} from '../identity/testing/identity-store-fixtures.ts';
import {
  db,
  insertLaunch,
  insertProduct,
  insertUser,
  launchIdOf,
  productIdOf,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import { D1BracketStore } from './d1-bracket-store.ts';
import {
  bracketIdOf,
  bracketMatchIdOf,
  clearBracketTables,
  entryRefOf,
  insertBracketMatches,
  insertBrackets,
  insertParticipants,
  type ParticipantFixture,
  tournamentIdOf,
} from './testing/bracket-fixtures.ts';

const IDS_OVER_ONE_STATEMENT = 95;

const store = new D1BracketStore(db);

function linkedParticipant(
  index: number,
  bracket: number,
  participantNo: number,
  product: number,
  columns: ParticipantFixture['columns'] = {},
): ParticipantFixture {
  return {
    index,
    bracket,
    participantNo,
    entry: index,
    launch: product,
    product,
    owner: product <= 2 ? 1 : 2,
    columns,
  };
}

// 利用者1のプロダクト1・2と利用者2のプロダクト3・4を、同じ番号のローンチ付きで作る
async function seedOwners(): Promise<void> {
  await clearBracketTables();
  await insertUser(1);
  await insertUser(2);
  for (const index of [1, 2, 3, 4]) {
    await insertProduct(index, index <= 2 ? 1 : 2);
    await insertLaunch(index, index);
  }
}

// 参加3(シード1・1回戦1マッチ)のWeekのブラケット1で、1回戦が確定し2回戦(決勝)を予定済み
async function seedActiveWeekBracket(): Promise<void> {
  await insertBrackets([{ index: 1, participantCount: 3 }]);
  await insertParticipants([
    linkedParticipant(1, 1, 1, 1),
    linkedParticipant(2, 1, 2, 2),
    linkedParticipant(3, 1, 3, 3, { eliminatedRound: 1 }),
  ]);
  await insertBracketMatches([
    {
      index: 1,
      bracket: 1,
      round: 1,
      position: 1,
      participantNos: [2, 3],
      columns: {
        status: 'decided',
        winnerParticipantNo: 2,
        decidedAt: new Date('2026-11-25T07:40:00.000Z'),
      },
    },
    {
      index: 2,
      bracket: 1,
      round: 2,
      position: 1,
      participantNos: [1, 2],
      columns: { matchDate: '2026-11-25', status: 'planned' },
    },
  ]);
}

beforeEach(seedOwners);

describe('D1BracketStore.findByTournament・findById', () => {
  test('種類と識別子で、形・参加者・マッチを含むブラケットの記録を読む', async () => {
    await seedActiveWeekBracket();

    const record = await store.findByTournament('week', tournamentIdOf(1));

    expect(record).toEqual({
      bracketId: bracketIdOf(1),
      kind: 'week',
      tournamentId: tournamentIdOf(1),
      shape: bracketShape(3),
      firstRoundDate: '2026-11-24',
      status: 'active',
      outcome: null,
      championRef: null,
      participants: [
        {
          participantNo: 1,
          ref: entryRefOf(1),
          productId: productIdOf(1),
          launchId: launchIdOf(1),
          ownerUserId: userIdOf(1),
          eliminatedRound: null,
        },
        {
          participantNo: 2,
          ref: entryRefOf(2),
          productId: productIdOf(2),
          launchId: launchIdOf(2),
          ownerUserId: userIdOf(1),
          eliminatedRound: null,
        },
        {
          participantNo: 3,
          ref: entryRefOf(3),
          productId: productIdOf(3),
          launchId: launchIdOf(3),
          ownerUserId: userIdOf(2),
          eliminatedRound: 1,
        },
      ],
      matches: [
        {
          matchId: bracketMatchIdOf(1),
          round: 1,
          position: 1,
          matchDate: '2026-11-24',
          participantNos: [2, 3],
          status: 'decided',
          winnerNo: 2,
        },
        {
          matchId: bracketMatchIdOf(2),
          round: 2,
          position: 1,
          matchDate: '2026-11-25',
          participantNos: [1, 2],
          status: 'planned',
          winnerNo: null,
        },
      ],
    });
    await expect(store.findById(bracketIdOf(1))).resolves.toEqual(record);
  });

  test('同じ識別子のトーナメントでも種類が違うブラケットは別に読む', async () => {
    await insertBrackets([
      { index: 1, kind: 'week', tournament: 7, participantCount: 0 },
      { index: 2, kind: 'year', tournament: 7, participantCount: 2 },
    ]);

    await expect(
      store.findByTournament('week', tournamentIdOf(7)),
    ).resolves.toMatchObject({ bracketId: bracketIdOf(1), kind: 'week' });
    await expect(
      store.findByTournament('year', tournamentIdOf(7)),
    ).resolves.toMatchObject({ bracketId: bracketIdOf(2), kind: 'year' });
  });

  test('参加者もマッチも無いブラケットは空の一覧と記録したままの形で読む', async () => {
    await insertBrackets([
      {
        index: 1,
        participantCount: 1,
        columns: {
          firstRoundDate: null,
          status: 'finished',
          outcome: 'no_award',
          finishedAt: new Date('2026-11-24T07:45:00.000Z'),
        },
      },
    ]);

    await expect(store.findById(bracketIdOf(1))).resolves.toMatchObject({
      shape: bracketShape(1),
      firstRoundDate: null,
      status: 'finished',
      outcome: 'no_award',
      championRef: null,
      participants: [],
      matches: [],
    });
  });

  test('優勝で終わったブラケットは優勝した参加者のrefを返し、側1つのマッチは参加者の番号を1つだけ返す', async () => {
    await insertBrackets([
      {
        index: 1,
        participantCount: 2,
        columns: {
          status: 'finished',
          outcome: 'champion',
          championParticipantNo: 2,
          finishedAt: new Date('2026-11-25T07:45:00.000Z'),
        },
      },
    ]);
    await insertParticipants([
      linkedParticipant(1, 1, 1, 1, { eliminatedRound: 1 }),
      linkedParticipant(2, 1, 2, 2),
    ]);
    await insertBracketMatches([
      {
        index: 1,
        bracket: 1,
        round: 1,
        position: 1,
        participantNos: [2],
        columns: { status: 'decided', winnerParticipantNo: 2 },
      },
    ]);

    const record = await store.findById(bracketIdOf(1));

    expect(record?.championRef).toBe(entryRefOf(2));
    expect(record?.matches.map((match) => match.participantNos)).toEqual([[2]]);
  });

  test('記録が無ければundefinedを返す', async () => {
    await seedActiveWeekBracket();

    await expect(
      store.findByTournament('year', tournamentIdOf(1)),
    ).resolves.toBeUndefined();
    await expect(
      store.findByTournament('week', tournamentIdOf(2)),
    ).resolves.toBeUndefined();
    await expect(store.findById(bracketIdOf(2))).resolves.toBeUndefined();
  });
});

describe('D1BracketStore.findByMatchIds', () => {
  test('ブラケットのマッチのIDからブラケットの種類と識別子を引き、それ以外のIDを含めない', async () => {
    await seedActiveWeekBracket();
    await insertBrackets([{ index: 2, kind: 'year', participantCount: 2 }]);
    await insertBracketMatches([
      { index: 3, bracket: 2, round: 1, position: 1, participantNos: [1, 2] },
    ]);

    const found = await store.findByMatchIds([
      bracketMatchIdOf(2),
      bracketMatchIdOf(3),
      bracketMatchIdOf(2),
      bracketMatchIdOf(9),
    ]);

    expect(found).toEqual(
      new Map([
        [
          bracketMatchIdOf(2),
          {
            bracketId: bracketIdOf(1),
            kind: 'week',
            tournamentId: tournamentIdOf(1),
          },
        ],
        [
          bracketMatchIdOf(3),
          {
            bracketId: bracketIdOf(2),
            kind: 'year',
            tournamentId: tournamentIdOf(2),
          },
        ],
      ]),
    );
  });

  test('空の入力では問い合わせずに空の結果を返す', async () => {
    const recording = createRecordingDatabase();

    await expect(
      new D1BracketStore(recording.database).findByMatchIds([]),
    ).resolves.toEqual(new Map());
    expect(recording.placeholderCounts).toEqual([]);
  });

  test('90件を超えるIDはバインド変数の上限に収まるよう分けて引き、すべて結果に含める', async () => {
    await insertBrackets([{ index: 1, participantCount: 256 }]);
    const indexes = Array.from(
      { length: IDS_OVER_ONE_STATEMENT },
      (_, offset) => offset + 1,
    );
    await insertBracketMatches(
      indexes.map((index) => ({
        index,
        bracket: 1,
        round: 1,
        position: index,
        participantNos: [index * 2 - 1, index * 2],
      })),
    );
    const recording = createRecordingDatabase();

    const found = await new D1BracketStore(recording.database).findByMatchIds(
      indexes.map(bracketMatchIdOf),
    );

    expect([...found.keys()].toSorted()).toEqual(
      indexes.map(bracketMatchIdOf).toSorted(),
    );
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });
});

describe('D1BracketStore.findAliveRefs', () => {
  test('進行中のブラケットで敗退していない参加者のrefだけを返す', async () => {
    await seedActiveWeekBracket();

    await expect(
      store.findAliveRefs('week', [
        entryRefOf(1),
        entryRefOf(2),
        entryRefOf(3),
        entryRefOf(9),
      ]),
    ).resolves.toEqual(new Set([entryRefOf(1), entryRefOf(2)]));
  });

  test('指定した種類のブラケットの参加者だけを返す', async () => {
    await seedActiveWeekBracket();

    await expect(
      store.findAliveRefs('year', [entryRefOf(1), entryRefOf(2)]),
    ).resolves.toEqual(new Set());
  });

  test('優勝した参加者と、終了したブラケットの参加者を返さない', async () => {
    await insertBrackets([
      {
        index: 1,
        participantCount: 2,
        columns: {
          status: 'finished',
          outcome: 'champion',
          championParticipantNo: 1,
          finishedAt: new Date('2026-11-24T07:45:00.000Z'),
        },
      },
      {
        index: 2,
        participantCount: 2,
        columns: { outcome: 'champion', championParticipantNo: 1 },
      },
    ]);
    await insertParticipants([
      linkedParticipant(1, 1, 1, 1),
      linkedParticipant(2, 1, 2, 2),
      linkedParticipant(3, 2, 1, 3),
      linkedParticipant(4, 2, 2, 4),
    ]);

    await expect(
      store.findAliveRefs('week', [
        entryRefOf(1),
        entryRefOf(2),
        entryRefOf(3),
        entryRefOf(4),
      ]),
    ).resolves.toEqual(new Set([entryRefOf(4)]));
  });

  test('空の入力では問い合わせずに空の結果を返す', async () => {
    const recording = createRecordingDatabase();

    await expect(
      new D1BracketStore(recording.database).findAliveRefs('week', []),
    ).resolves.toEqual(new Set());
    expect(recording.placeholderCounts).toEqual([]);
  });

  test('90件を超えるrefはバインド変数の上限に収まるよう分けて判定する', async () => {
    await seedActiveWeekBracket();
    const refs = [
      ...Array.from({ length: IDS_OVER_ONE_STATEMENT }, (_, offset) =>
        entryRefOf(offset + 100),
      ),
      entryRefOf(1),
    ];
    const recording = createRecordingDatabase();

    await expect(
      new D1BracketStore(recording.database).findAliveRefs('week', refs),
    ).resolves.toEqual(new Set([entryRefOf(1)]));
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });
});

describe('D1BracketStore.findParticipantStandings', () => {
  test('参加者のrefごとにブラケットの形・状態・番号・敗退のラウンドを返し、参加者でないrefを含めない', async () => {
    await seedActiveWeekBracket();

    await expect(
      store.findParticipantStandings('week', [
        entryRefOf(1),
        entryRefOf(3),
        entryRefOf(9),
      ]),
    ).resolves.toEqual(
      new Map([
        [
          entryRefOf(1),
          {
            bracketId: bracketIdOf(1),
            shape: bracketShape(3),
            status: 'active',
            participantNo: 1,
            eliminatedRound: null,
            champion: false,
          },
        ],
        [
          entryRefOf(3),
          {
            bracketId: bracketIdOf(1),
            shape: bracketShape(3),
            status: 'active',
            participantNo: 3,
            eliminatedRound: 1,
            champion: false,
          },
        ],
      ]),
    );
  });

  test('指定した種類のブラケットの参加者だけを返す', async () => {
    await seedActiveWeekBracket();

    await expect(
      store.findParticipantStandings('year', [entryRefOf(1)]),
    ).resolves.toEqual(new Map());
  });

  test('複数のブラケットの参加者を引き、優勝した参加者だけに優勝の印を付ける', async () => {
    await insertBrackets([
      {
        index: 1,
        participantCount: 2,
        columns: {
          status: 'finished',
          outcome: 'champion',
          championParticipantNo: 1,
          finishedAt: new Date('2026-11-24T07:45:00.000Z'),
        },
      },
      { index: 2, participantCount: 5 },
    ]);
    await insertParticipants([
      linkedParticipant(1, 1, 1, 1),
      linkedParticipant(2, 1, 2, 2, { eliminatedRound: 1 }),
      linkedParticipant(3, 2, 4, 3),
    ]);

    const standings = await store.findParticipantStandings('week', [
      entryRefOf(1),
      entryRefOf(2),
      entryRefOf(3),
    ]);

    expect(standings.get(entryRefOf(1))).toEqual({
      bracketId: bracketIdOf(1),
      shape: bracketShape(2),
      status: 'finished',
      participantNo: 1,
      eliminatedRound: null,
      champion: true,
    });
    expect(standings.get(entryRefOf(2))).toMatchObject({
      status: 'finished',
      eliminatedRound: 1,
      champion: false,
    });
    expect(standings.get(entryRefOf(3))).toEqual({
      bracketId: bracketIdOf(2),
      shape: bracketShape(5),
      status: 'active',
      participantNo: 4,
      eliminatedRound: null,
      champion: false,
    });
  });

  test('空の入力では問い合わせずに空の結果を返す', async () => {
    const recording = createRecordingDatabase();

    await expect(
      new D1BracketStore(recording.database).findParticipantStandings(
        'week',
        [],
      ),
    ).resolves.toEqual(new Map());
    expect(recording.placeholderCounts).toEqual([]);
  });

  test('90件を超えるrefはバインド変数の上限に収まるよう分けて引く', async () => {
    await seedActiveWeekBracket();
    const refs = [
      ...Array.from({ length: IDS_OVER_ONE_STATEMENT }, (_, offset) =>
        entryRefOf(offset + 100),
      ),
      entryRefOf(2),
    ];
    const recording = createRecordingDatabase();

    const standings = await new D1BracketStore(
      recording.database,
    ).findParticipantStandings('week', refs);

    expect([...standings.keys()]).toEqual([entryRefOf(2)]);
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });
});

describe('D1BracketStore.unlinkProduct', () => {
  test('プロダクトの参加者のプロダクト・ローンチ・投稿者の紐付けだけを全てのブラケットで解除し、解除した数を返す', async () => {
    await seedActiveWeekBracket();
    await insertBrackets([{ index: 2, kind: 'year', participantCount: 2 }]);
    await insertParticipants([
      linkedParticipant(4, 2, 1, 3),
      linkedParticipant(5, 2, 2, 4),
    ]);

    await expect(store.unlinkProduct(productIdOf(3))).resolves.toBe(2);

    const week = await store.findById(bracketIdOf(1));
    const year = await store.findById(bracketIdOf(2));
    expect(week?.participants[2]).toEqual({
      participantNo: 3,
      ref: entryRefOf(3),
      productId: null,
      launchId: null,
      ownerUserId: null,
      eliminatedRound: 1,
    });
    expect(year?.participants).toEqual([
      expect.objectContaining({
        ref: entryRefOf(4),
        productId: null,
        launchId: null,
        ownerUserId: null,
      }),
      expect.objectContaining({
        ref: entryRefOf(5),
        productId: productIdOf(4),
        launchId: launchIdOf(4),
        ownerUserId: userIdOf(2),
      }),
    ]);
    expect(
      week?.participants
        .slice(0, 2)
        .map((participant) => participant.productId),
    ).toEqual([productIdOf(1), productIdOf(2)]);
  });

  test('解除の後は、プロダクト・ローンチ・投稿者を物理削除しても外部キーの違反にならない', async () => {
    await seedActiveWeekBracket();

    await expect(store.unlinkProduct(productIdOf(3))).resolves.toBe(1);
    await expect(store.unlinkProduct(productIdOf(4))).resolves.toBe(0);

    await db
      .delete(productLaunches)
      .where(eq(productLaunches.productId, productIdOf(3)));
    await db
      .delete(productLaunches)
      .where(eq(productLaunches.productId, productIdOf(4)));
    await db.delete(products).where(eq(products.userId, userIdOf(2)));
    await db.delete(users).where(eq(users.id, userIdOf(2)));
    await expect(
      db
        .select({ ref: bracketParticipants.entryRef })
        .from(bracketParticipants)
        .where(eq(bracketParticipants.participantNo, 3)),
    ).resolves.toEqual([{ ref: entryRefOf(3) }]);
  });

  test('紐付けの無いプロダクトでは何も変えず0を返す', async () => {
    await seedActiveWeekBracket();
    const before = await store.findById(bracketIdOf(1));

    await expect(store.unlinkProduct(productIdOf(4))).resolves.toBe(0);
    await expect(store.findById(bracketIdOf(1))).resolves.toEqual(before);
  });

  test('1つの文で解除する', async () => {
    await seedActiveWeekBracket();
    const recording = createRecordingDatabase();

    await new D1BracketStore(recording.database).unlinkProduct(productIdOf(3));

    expect(recording.placeholderCounts).toHaveLength(1);
    expectWithinBindLimit(recording.placeholderCounts);
  });
});
