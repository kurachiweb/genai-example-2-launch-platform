import { describe, expect, test, vi } from 'vitest';

import { matchWindow } from '../../../../../lib/core/match/match-model.ts';
import { fromBusinessDateTime } from '../../../../../lib/core/time/business-time.ts';
import {
  entryIdOf,
  type EntryFixture,
  insertMatches,
  type MatchFixture,
  matchIdOf,
} from '../../../../../lib/workers/match/testing/match-fixtures.ts';
import {
  insertProducts,
  insertUser,
  T0,
} from '../../../../../lib/workers/product/testing/product-fixtures.ts';
import {
  type BracketMatchFixture,
  bracketIdOf,
  insertBracketMatches,
  insertBrackets,
} from '../../../../../lib/workers/tournament/testing/bracket-fixtures.ts';
import {
  insertYearTournaments,
  YEAR,
  YEAR_SCHEDULE,
  yearEntryIdOf,
  yearTournamentIdOf,
} from '../../../../../lib/workers/year-tournament/testing/year-tournament-fixtures.ts';
import { codesOf } from '../../../../../test/support/match-graphql-operations.ts';
import {
  fetchYearTournamentBoard,
  installYearTournamentGraphQLTest,
  setYearTestNow,
  YEAR_BOARD_DATE,
  YEAR_FINAL_DATE,
  YEAR_TEST_NOW,
} from '../../../../../test/support/year-tournament-graphql-operations.ts';
import { DirectoryMatchViewReader } from '../../../../application/match/match-view-reader.ts';

installYearTournamentGraphQLTest();

const OWNER = 1;

const WINDOW = matchWindow(YEAR_BOARD_DATE);

const EARLY_END = new Date(WINDOW.startsAt.getTime() + 3_600_000);

const HIDDEN_PRODUCT = 8;

const VALIDATION_MESSAGE = '入力内容を確認してください。';

const BRACKET_PATH = `/tournaments/year/${String(YEAR)}`;

function side(
  index: number,
  product: number | null,
  columns: EntryFixture['columns'] = {},
): EntryFixture {
  return {
    index,
    launch: null,
    product,
    owner: product === null ? null : OWNER,
    columns,
  };
}

function yearMatch(
  index: number,
  entries: readonly EntryFixture[],
  columns: MatchFixture['columns'] = {},
): MatchFixture {
  return {
    index,
    columns: {
      kind: 'year',
      round: 1,
      matchDate: YEAR_BOARD_DATE,
      startsAt: WINDOW.startsAt,
      endsAt: WINDOW.endsAt,
      startedAt: WINDOW.startsAt,
      ...columns,
    },
    entries,
  };
}

function scheduledNode(
  index: number,
  position: number,
  participantNos: readonly [number] | readonly [number, number],
): BracketMatchFixture {
  return {
    index,
    bracket: 1,
    round: 1,
    position,
    participantNos,
    columns: { matchId: matchIdOf(index), matchDate: YEAR_BOARD_DATE },
  };
}

const lost = { result: 'lost', forfeitedAt: T0 } as const;

// 2027年(参加16・1回戦)は 対戦カード1・対戦相手不在2・開始時点の不戦敗3・即時の終了4・両者の不戦敗5・非公開のプロダクトを含む対戦カード6。
// マッチの番号はブラケットの位置の逆順に並べ、位置の順に返すことを確かめる
async function seedFirstRound(): Promise<void> {
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertProducts([1, 2, 3, 4, 5, 6, 7, 9], OWNER);
  await insertProducts([HIDDEN_PRODUCT], OWNER, { hiddenAt: T0 });
  await insertMatches([
    yearMatch(1, [
      side(11, 1, { upvoteCount: 3 }),
      side(12, 2, { upvoteCount: 2 }),
    ]),
    yearMatch(2, [side(21, 3, { result: 'bye' })], {
      decision: 'bye',
      decidedAt: WINDOW.startsAt,
    }),
    yearMatch(3, [side(31, 4, { result: 'walkover' }), side(32, 5, lost)], {
      decision: 'walkover',
      decidedAt: WINDOW.startsAt,
    }),
    yearMatch(
      4,
      [side(41, 6, { upvoteCount: 4, result: 'walkover' }), side(42, 7, lost)],
      { decision: 'walkover', decidedAt: EARLY_END, endedEarlyAt: EARLY_END },
    ),
    yearMatch(5, [side(51, 1, lost), side(52, 2, lost)], {
      decision: 'both_forfeited',
      decidedAt: WINDOW.startsAt,
    }),
    yearMatch(6, [side(61, HIDDEN_PRODUCT), side(62, 9, { upvoteCount: 1 })]),
  ]);
  await insertBrackets([
    {
      index: 1,
      kind: 'year',
      participantCount: 16,
      columns: {
        tournamentId: yearTournamentIdOf(1),
        firstRoundDate: YEAR_BOARD_DATE,
      },
    },
  ]);
  await insertBracketMatches([
    scheduledNode(1, 6, [1, 2]),
    scheduledNode(2, 5, [3]),
    scheduledNode(3, 4, [5, 6]),
    scheduledNode(4, 3, [7, 8]),
    scheduledNode(5, 2, [9, 10]),
    scheduledNode(6, 1, [11, 12]),
  ]);
  await insertYearTournaments([
    {
      index: 1,
      columns: {
        status: 'in_progress',
        drawStartedAt: YEAR_SCHEDULE.drawAt,
        drawnAt: YEAR_SCHEDULE.drawAt,
        bracketId: bracketIdOf(1),
        firstRoundDate: YEAR_BOARD_DATE,
        participantCount: 16,
      },
    },
  ]);
}

const AFTER_FINAL = fromBusinessDateTime(YEAR_FINAL_DATE, {
  hour: 23,
  minute: 50,
});

// 参加2の決勝を終え、1が受賞した2027年
async function seedAwardedFinal(): Promise<void> {
  const window = matchWindow(YEAR_FINAL_DATE);
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertProducts([1, 2], OWNER);
  await insertMatches([
    {
      index: 1,
      columns: {
        kind: 'year',
        round: 1,
        stage: 'final',
        matchDate: YEAR_FINAL_DATE,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        startedAt: window.startsAt,
        decidedAt: window.endsAt,
        decision: 'votes',
      },
      entries: [
        side(11, 1, { result: 'won', upvoteCount: 5 }),
        side(12, 2, { result: 'lost', upvoteCount: 2 }),
      ],
    },
  ]);
  await insertBrackets([
    {
      index: 1,
      kind: 'year',
      participantCount: 2,
      columns: {
        tournamentId: yearTournamentIdOf(1),
        firstRoundDate: YEAR_FINAL_DATE,
        status: 'finished',
        outcome: 'champion',
        championParticipantNo: 1,
      },
    },
  ]);
  await insertBracketMatches([
    {
      index: 1,
      bracket: 1,
      round: 1,
      position: 1,
      participantNos: [1, 2],
      columns: {
        matchId: matchIdOf(1),
        matchDate: YEAR_FINAL_DATE,
        status: 'decided',
        winnerParticipantNo: 1,
      },
    },
  ]);
  await insertYearTournaments([
    {
      index: 1,
      columns: {
        status: 'finished',
        drawStartedAt: YEAR_SCHEDULE.drawAt,
        drawnAt: YEAR_SCHEDULE.drawAt,
        bracketId: bracketIdOf(1),
        firstRoundDate: YEAR_FINAL_DATE,
        participantCount: 2,
        outcome: 'awarded',
        championEntryId: yearEntryIdOf(1),
        awardedAt: AFTER_FINAL,
      },
    },
  ]);
}

describe('yearTournamentBoard', () => {
  test('その日のマッチを年とラウンドの行で返し、見出しの対象年・ラウンド名・決勝日とブラケットへのパスを添える', async () => {
    await seedFirstRound();

    const response = await fetchYearTournamentBoard(YEAR_BOARD_DATE);

    expect(response.errors).toBeUndefined();
    const board = response.data?.yearTournamentBoard;
    expect(board?.date).toBe(YEAR_BOARD_DATE);
    expect(board?.serverTime).toBe(YEAR_TEST_NOW.toISOString());
    expect(
      board?.rounds.map(
        ({ tournament, round, roundName, final, finalDate, bracketPath }) => ({
          tournament,
          round,
          roundName,
          final,
          finalDate,
          bracketPath,
        }),
      ),
    ).toEqual([
      {
        tournament: {
          year: YEAR,
          label: '2027年',
          finalDate: YEAR_FINAL_DATE,
          firstRoundDate: YEAR_BOARD_DATE,
          status: 'IN_PROGRESS',
          awarded: null,
        },
        round: 1,
        roundName: '1回戦',
        final: false,
        finalDate: YEAR_FINAL_DATE,
        bracketPath: BRACKET_PATH,
      },
    ]);
  });

  test('側が1つは対戦相手不在、開始時点の相手の不戦敗は不戦敗による勝利、即時の終了は早期の勝利の不戦勝に分け、両者の不戦敗は表示しない', async () => {
    await seedFirstRound();

    const response = await fetchYearTournamentBoard(YEAR_BOARD_DATE);

    expect(response.errors).toBeUndefined();
    const row = response.data?.yearTournamentBoard?.rounds[0];
    expect(row?.matches.map(({ id }) => id)).toEqual([
      matchIdOf(6),
      matchIdOf(1),
    ]);
    expect(row?.matches[0]).toEqual(
      expect.objectContaining({
        kind: 'YEAR',
        round: 1,
        phase: 'LIVE',
        entries: [
          expect.objectContaining({ id: entryIdOf(61), product: null }),
          expect.objectContaining({
            id: entryIdOf(62),
            product: expect.objectContaining({ handle: 'product9' }) as never,
            upvoteCount: 1,
          }),
        ],
      }),
    );
    expect(
      row?.byes.map(({ match, entry, reason }) => ({
        matchId: match.id,
        kind: match.kind,
        decision: match.decision,
        endedEarly: match.endedEarly,
        entryId: entry.id,
        handle: entry.product?.handle,
        upvoteCount: entry.upvoteCount,
        result: entry.result,
        reason,
      })),
    ).toEqual([
      {
        matchId: matchIdOf(4),
        kind: 'YEAR',
        decision: 'WALKOVER',
        endedEarly: true,
        entryId: entryIdOf(41),
        handle: 'product6',
        upvoteCount: 4,
        result: 'WALKOVER',
        reason: 'EARLY',
      },
      {
        matchId: matchIdOf(3),
        kind: 'YEAR',
        decision: 'WALKOVER',
        endedEarly: false,
        entryId: entryIdOf(31),
        handle: 'product4',
        upvoteCount: 0,
        result: 'WALKOVER',
        reason: 'FORFEIT',
      },
      {
        matchId: matchIdOf(2),
        kind: 'YEAR',
        decision: 'BYE',
        endedEarly: false,
        entryId: entryIdOf(21),
        handle: 'product3',
        upvoteCount: 0,
        result: 'BYE',
        reason: 'ABSENT',
      },
    ]);
  });

  test('行のマッチの表示を1回のまとめた読み取りで引き、問い合わせの回数をマッチの数に比例させない', async () => {
    await seedFirstRound();
    const findViews = vi.spyOn(DirectoryMatchViewReader.prototype, 'findViews');

    const response = await fetchYearTournamentBoard(YEAR_BOARD_DATE);

    expect(response.errors).toBeUndefined();
    expect(findViews).toHaveBeenCalledTimes(1);
    expect(findViews.mock.calls[0]?.[0].matchIds.toSorted()).toEqual(
      [1, 2, 3, 4, 5, 6].map(matchIdOf).toSorted(),
    );
  });

  test('受賞が確定した決勝の行は、決勝の印と年の終了・受賞を返す', async () => {
    await seedAwardedFinal();
    setYearTestNow(AFTER_FINAL);

    const response = await fetchYearTournamentBoard(YEAR_FINAL_DATE);

    expect(response.errors).toBeUndefined();
    const [row, ...rest] = response.data?.yearTournamentBoard?.rounds ?? [];
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      tournament: {
        year: YEAR,
        finalDate: YEAR_FINAL_DATE,
        firstRoundDate: YEAR_FINAL_DATE,
        status: 'FINISHED',
        awarded: true,
      },
      round: 1,
      roundName: '決勝',
      final: true,
      finalDate: YEAR_FINAL_DATE,
      bracketPath: BRACKET_PATH,
      byes: [],
    });
    expect(row?.matches.map(({ id, phase }) => ({ id, phase }))).toEqual([
      { id: matchIdOf(1), phase: 'FINISHED' },
    ]);
  });

  test('その日にYearトーナメントのマッチが無ければ行を空にする', async () => {
    await seedFirstRound();

    const response = await fetchYearTournamentBoard(YEAR_FINAL_DATE);

    expect(response.errors).toBeUndefined();
    expect(response.data?.yearTournamentBoard?.rounds).toEqual([]);
  });

  test.each(['2027-02-30', '2027/05/27', '', '20270527'])(
    '業務日付の形式の違反(%s)はvalidation_errorにする',
    async (date) => {
      const response = await fetchYearTournamentBoard(date);

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(response.errors?.[0]?.message).toBe(VALIDATION_MESSAGE);
      expect(response.errors?.[0]?.extensions?.details).toEqual([
        expect.objectContaining({ field: 'date' }),
      ]);
    },
  );

  test('管理者側の呼び出し元からの要求はforbiddenで拒否する', async () => {
    const response = await fetchYearTournamentBoard(YEAR_BOARD_DATE, {
      caller: 'admin',
    });

    expect(codesOf(response)).toEqual(['forbidden']);
  });
});
