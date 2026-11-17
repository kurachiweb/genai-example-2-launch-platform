import { describe, expect, test, vi } from 'vitest';

import { formatWeekPeriodLabel } from '../../../../../common-lib/tournament/week-period.ts';
import { matchWindow } from '../../../../../lib/core/match/match-model.ts';
import { parseBusinessDate } from '../../../../../lib/core/time/business-time.ts';
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
  bracketIdOf,
  insertBracketMatches,
  insertBrackets,
} from '../../../../../lib/workers/tournament/testing/bracket-fixtures.ts';
import { insertWeekTournaments } from '../../../../../lib/workers/week-tournament/testing/week-tournament-fixtures.ts';
import { codesOf } from '../../../../../test/support/match-graphql-operations.ts';
import {
  BOARD_DATE,
  fetchWeekTournamentBoard,
  installWeekTournamentGraphQLTest,
  WEEK_TEST_NOW,
} from '../../../../../test/support/week-tournament-graphql-operations.ts';
import { DirectoryMatchViewReader } from '../../../../application/match/match-view-reader.ts';

installWeekTournamentGraphQLTest();

const OWNER = 1;

const WINDOW = matchWindow(parseBusinessDate(BOARD_DATE));

const PREVIOUS_DAY = '2026-11-23';

const EARLY_END = new Date(WINDOW.startsAt.getTime() + 3_600_000);

const HIDDEN_PRODUCT = 8;

const VALIDATION_MESSAGE = '入力内容を確認してください。';

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

function weekMatch(
  index: number,
  round: number,
  entries: readonly EntryFixture[],
  columns: MatchFixture['columns'] = {},
): MatchFixture {
  return {
    index,
    columns: {
      kind: 'week',
      round,
      matchDate: BOARD_DATE,
      startsAt: WINDOW.startsAt,
      endsAt: WINDOW.endsAt,
      startedAt: WINDOW.startsAt,
      ...columns,
    },
    entries,
  };
}

const lost = { result: 'lost', forfeitedAt: T0 } as const;

// 今週(参加16・1回戦)は 対戦カード1・対戦相手不在2・開始時点の不戦敗3・即時の終了4・両者の不戦敗5・非公開のプロダクトを含む対戦カード6、
// 先週(参加4・決勝)は対戦カード20。マッチの番号はブラケットの位置の逆順に並べ、位置の順に返すことを確かめる
async function seedBoard(): Promise<void> {
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertProducts([1, 2, 3, 4, 5, 6, 7, 9, 10, 11], OWNER);
  await insertProducts([HIDDEN_PRODUCT], OWNER, { hiddenAt: T0 });
  await insertMatches([
    weekMatch(1, 1, [
      side(11, 1, { upvoteCount: 3 }),
      side(12, 2, { upvoteCount: 2 }),
    ]),
    weekMatch(2, 1, [side(21, 3, { result: 'bye' })], {
      decision: 'bye',
      decidedAt: WINDOW.startsAt,
    }),
    weekMatch(3, 1, [side(31, 4, { result: 'walkover' }), side(32, 5, lost)], {
      decision: 'walkover',
      decidedAt: WINDOW.startsAt,
    }),
    weekMatch(
      4,
      1,
      [side(41, 6, { upvoteCount: 4, result: 'walkover' }), side(42, 7, lost)],
      { decision: 'walkover', decidedAt: EARLY_END, endedEarlyAt: EARLY_END },
    ),
    weekMatch(5, 1, [side(51, 1, lost), side(52, 2, lost)], {
      decision: 'both_forfeited',
      decidedAt: WINDOW.startsAt,
    }),
    weekMatch(6, 1, [
      side(61, HIDDEN_PRODUCT),
      side(62, 9, { upvoteCount: 1 }),
    ]),
    weekMatch(20, 2, [side(201, 10), side(202, 11)], { stage: 'final' }),
  ]);
  await insertBrackets([
    { index: 1, participantCount: 16 },
    {
      index: 2,
      participantCount: 4,
      columns: { firstRoundDate: PREVIOUS_DAY },
    },
  ]);
  const scheduled = (matchIndex: number) => ({
    matchId: matchIdOf(matchIndex),
    matchDate: BOARD_DATE,
  });
  await insertBracketMatches([
    {
      index: 1,
      bracket: 1,
      round: 1,
      position: 6,
      participantNos: [1, 2],
      columns: scheduled(1),
    },
    {
      index: 2,
      bracket: 1,
      round: 1,
      position: 5,
      participantNos: [3],
      columns: scheduled(2),
    },
    {
      index: 3,
      bracket: 1,
      round: 1,
      position: 4,
      participantNos: [5, 6],
      columns: scheduled(3),
    },
    {
      index: 4,
      bracket: 1,
      round: 1,
      position: 3,
      participantNos: [7, 8],
      columns: scheduled(4),
    },
    {
      index: 5,
      bracket: 1,
      round: 1,
      position: 2,
      participantNos: [9, 10],
      columns: scheduled(5),
    },
    {
      index: 6,
      bracket: 1,
      round: 1,
      position: 1,
      participantNos: [11, 12],
      columns: scheduled(6),
    },
    {
      index: 21,
      bracket: 2,
      round: 1,
      position: 1,
      participantNos: [1, 2],
      columns: {
        matchDate: PREVIOUS_DAY,
        status: 'decided',
        winnerParticipantNo: 1,
      },
    },
    {
      index: 22,
      bracket: 2,
      round: 1,
      position: 2,
      participantNos: [3, 4],
      columns: {
        matchDate: PREVIOUS_DAY,
        status: 'decided',
        winnerParticipantNo: 3,
      },
    },
    {
      index: 20,
      bracket: 2,
      round: 2,
      position: 1,
      participantNos: [1, 3],
      columns: scheduled(20),
    },
  ]);
  await insertWeekTournaments([
    { index: 1, columns: { status: 'in_progress', bracketId: bracketIdOf(1) } },
    {
      index: 2,
      weekStart: '2026-11-09',
      columns: { status: 'in_progress', bracketId: bracketIdOf(2) },
    },
  ]);
}

describe('weekTournamentBoard', () => {
  test('その日のマッチを、先に開始したトーナメントから順にトーナメントとラウンドごとの行で返す', async () => {
    await seedBoard();

    const response = await fetchWeekTournamentBoard(BOARD_DATE);

    expect(response.errors).toBeUndefined();
    const board = response.data?.weekTournamentBoard;
    expect(board?.date).toBe(BOARD_DATE);
    expect(board?.serverTime).toBe(WEEK_TEST_NOW.toISOString());
    expect(
      board?.rounds.map(
        ({ tournament, round, roundName, final, bracketPath }) => ({
          tournament,
          round,
          roundName,
          final,
          bracketPath,
        }),
      ),
    ).toEqual([
      {
        tournament: {
          week: '2026-W46',
          label: formatWeekPeriodLabel('2026-11-09'),
          firstRoundDate: PREVIOUS_DAY,
          finalDate: BOARD_DATE,
          status: 'IN_PROGRESS',
          awarded: null,
        },
        round: 2,
        roundName: '決勝',
        final: true,
        bracketPath: '/tournaments/week/2026-W46',
      },
      {
        tournament: {
          week: '2026-W47',
          label: formatWeekPeriodLabel('2026-11-16'),
          firstRoundDate: BOARD_DATE,
          finalDate: '2026-11-27',
          status: 'IN_PROGRESS',
          awarded: null,
        },
        round: 1,
        roundName: '1回戦',
        final: false,
        bracketPath: '/tournaments/week/2026-W47',
      },
    ]);
    expect(board?.rounds[0]?.matches.map(({ id }) => id)).toEqual([
      matchIdOf(20),
    ]);
    expect(board?.rounds[0]?.byes).toEqual([]);
  });

  test('側が1つは対戦相手不在、開始時点の相手の不戦敗は不戦敗による勝利、即時の終了は早期の勝利の不戦勝に分け、両者の不戦敗は表示しない', async () => {
    await seedBoard();

    const response = await fetchWeekTournamentBoard(BOARD_DATE);

    expect(response.errors).toBeUndefined();
    const row = response.data?.weekTournamentBoard?.rounds[1];
    expect(row?.matches.map(({ id }) => id)).toEqual([
      matchIdOf(6),
      matchIdOf(1),
    ]);
    expect(row?.matches[0]).toEqual(
      expect.objectContaining({
        kind: 'WEEK',
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

  test('全ての行のマッチの表示を1回のまとめた読み取りで引き、問い合わせの回数をマッチの数に比例させない', async () => {
    await seedBoard();
    const findViews = vi.spyOn(DirectoryMatchViewReader.prototype, 'findViews');

    const response = await fetchWeekTournamentBoard(BOARD_DATE);

    expect(response.errors).toBeUndefined();
    expect(findViews).toHaveBeenCalledTimes(1);
    expect(findViews.mock.calls[0]?.[0].matchIds.toSorted()).toEqual(
      [1, 2, 3, 4, 5, 6, 20].map(matchIdOf).toSorted(),
    );
  });

  test('その日にWeekトーナメントのマッチが無ければ行を空にする', async () => {
    await seedBoard();

    const response = await fetchWeekTournamentBoard('2026-11-25');

    expect(response.errors).toBeUndefined();
    expect(response.data?.weekTournamentBoard?.rounds).toEqual([]);
  });

  test.each(['2026-11-31', '2026/11/24', '', '20261124'])(
    '業務日付の形式の違反(%s)はvalidation_errorにする',
    async (date) => {
      const response = await fetchWeekTournamentBoard(date);

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(response.errors?.[0]?.message).toBe(VALIDATION_MESSAGE);
      expect(response.errors?.[0]?.extensions?.details).toEqual([
        expect.objectContaining({ field: 'date' }),
      ]);
    },
  );

  test('管理者側の呼び出し元からの要求はforbiddenで拒否する', async () => {
    const response = await fetchWeekTournamentBoard(BOARD_DATE, {
      caller: 'admin',
    });

    expect(codesOf(response)).toEqual(['forbidden']);
  });
});
