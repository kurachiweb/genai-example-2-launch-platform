import { describe, expect, test, vi } from 'vitest';

import { PRODUCT_CATEGORY_OTHER_ID } from '../../../../../common-lib/product/product-category-constants.ts';
import { matchWindow } from '../../../../../lib/core/match/match-model.ts';
import {
  addBusinessDays,
  type BusinessDate,
  fromBusinessDateTime,
} from '../../../../../lib/core/time/business-time.ts';
import {
  type EntryFixture,
  insertMatches,
  type MatchFixture,
  matchIdOf,
} from '../../../../../lib/workers/match/testing/match-fixtures.ts';
import {
  insertLaunch,
  insertProducts,
  insertUser,
  T0,
} from '../../../../../lib/workers/product/testing/product-fixtures.ts';
import {
  type BracketMatchFixture,
  bracketIdOf,
  insertBracketMatches,
  insertBrackets,
  insertParticipants,
} from '../../../../../lib/workers/tournament/testing/bracket-fixtures.ts';
import {
  insertYearTournaments,
  YEAR,
  YEAR_SCHEDULE,
  yearEntryIdOf,
  yearTournamentIdOf,
} from '../../../../../lib/workers/year-tournament/testing/year-tournament-fixtures.ts';
import {
  fetchYearBracket,
  installYearTournamentGraphQLTest,
  setYearTestNow,
  YEAR_FINAL_DATE,
} from '../../../../../test/support/year-tournament-graphql-operations.ts';
import { DirectoryMatchViewReader } from '../../../../application/match/match-view-reader.ts';

installYearTournamentGraphQLTest();

const OWNER = 1;

const SUSPENDED_OWNER = 2;

const YEAR_KEY = String(YEAR);

// 参加6は1回戦が決勝の2日前、準決勝が前日
const FIRST_ROUND_DATE = addBusinessDays(YEAR_FINAL_DATE, -2);

const SEMIFINAL_DATE = addBusinessDays(YEAR_FINAL_DATE, -1);

const AFTER_FIRST_ROUND = fromBusinessDateTime(FIRST_ROUND_DATE, {
  hour: 23,
  minute: 50,
});

const AFTER_FINAL = fromBusinessDateTime(YEAR_FINAL_DATE, {
  hour: 23,
  minute: 50,
});

const HIDDEN_LOSER = 6;

const EMPTY_SLOT_FIELDS = { feedLabel: null, seed: null };

const NO_RESULT = { product: null, upvoteCount: null, result: null };

const WON = { result: 'won', upvoteCount: 7 } as const;

const LOST = { result: 'lost', upvoteCount: 2 } as const;

const DRAWN_COLUMNS = {
  drawStartedAt: YEAR_SCHEDULE.drawAt,
  drawnAt: YEAR_SCHEDULE.drawAt,
  bracketId: bracketIdOf(1),
};

function side(
  index: number,
  product: number,
  owner: number,
  columns: EntryFixture['columns'],
): EntryFixture {
  return { index, launch: null, product, owner, columns };
}

function decidedMatch(
  index: number,
  date: BusinessDate,
  entries: readonly EntryFixture[],
  decision: 'votes' | 'both_forfeited' = 'votes',
): MatchFixture {
  const window = matchWindow(date);
  return {
    index,
    columns: {
      kind: 'year',
      round: 1,
      matchDate: date,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      startedAt: window.startsAt,
      decidedAt: window.endsAt,
      decision,
    },
    entries,
  };
}

function decidedNode(
  index: number,
  position: number,
  participantNos: readonly [number, number],
  winner: number | null,
  date: BusinessDate,
): BracketMatchFixture {
  return {
    index,
    bracket: 1,
    round: 1,
    position,
    participantNos,
    columns: {
      matchId: matchIdOf(index),
      matchDate: date,
      status: 'decided',
      winnerParticipantNo: winner,
    },
  };
}

async function insertYearParticipants(
  participantNos: readonly number[],
  ownerOf: (participantNo: number) => number = () => OWNER,
): Promise<void> {
  await insertParticipants(
    participantNos.map((no) => ({
      index: no,
      bracket: 1,
      participantNo: no,
      entry: no,
      launch: null,
      product: no,
      owner: ownerOf(no),
      columns: { entryRef: yearEntryIdOf(no) },
    })),
  );
}

// 参加6(シード2)の1回戦を終えた2027年。1回戦は3対4(3の勝利)・5対6(5の勝利、6は非公開化中)で、準決勝の予定はまだ無い
async function seedFirstRoundDecided(): Promise<void> {
  await insertUser(OWNER);
  await insertProducts([1, 2, 3, 4, 5], OWNER);
  await insertProducts([HIDDEN_LOSER], OWNER, { hiddenAt: T0 });
  await insertMatches([
    decidedMatch(1, FIRST_ROUND_DATE, [
      side(11, 3, OWNER, WON),
      side(12, 4, OWNER, LOST),
    ]),
    decidedMatch(2, FIRST_ROUND_DATE, [
      side(21, 5, OWNER, WON),
      side(22, HIDDEN_LOSER, OWNER, LOST),
    ]),
  ]);
  await insertBrackets([
    {
      index: 1,
      kind: 'year',
      participantCount: 6,
      columns: {
        tournamentId: yearTournamentIdOf(1),
        firstRoundDate: FIRST_ROUND_DATE,
      },
    },
  ]);
  await insertYearParticipants([1, 2, 3, 4, 5, 6]);
  await insertBracketMatches([
    decidedNode(1, 1, [3, 4], 3, FIRST_ROUND_DATE),
    decidedNode(2, 2, [5, 6], 5, FIRST_ROUND_DATE),
  ]);
  await insertYearTournaments([
    {
      index: 1,
      columns: {
        ...DRAWN_COLUMNS,
        status: 'in_progress',
        firstRoundDate: FIRST_ROUND_DATE,
        participantCount: 6,
      },
    },
  ]);
}

type ChampionVisibility = 'visible' | 'hidden' | 'deleted' | 'suspended';

// 参加2の決勝を終えた2027年。1が優勝し、年の行に受賞を記録した
async function seedAwardedYear(visibility: ChampionVisibility): Promise<void> {
  await insertUser(OWNER);
  await insertUser(SUSPENDED_OWNER, { status: 'suspended', suspendedAt: T0 });
  const championOwner = visibility === 'suspended' ? SUSPENDED_OWNER : OWNER;
  await insertProducts([1], championOwner, {
    hiddenAt: visibility === 'hidden' ? T0 : null,
    deletedAt: visibility === 'deleted' ? T0 : null,
  });
  await insertProducts([2], OWNER);
  await insertLaunch(1, 1, { outcome: 'won' });
  await insertMatches([
    decidedMatch(1, YEAR_FINAL_DATE, [
      side(11, 1, championOwner, WON),
      side(12, 2, OWNER, LOST),
    ]),
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
  await insertYearParticipants([1, 2], (no) =>
    no === 1 ? championOwner : OWNER,
  );
  await insertBracketMatches([decidedNode(1, 1, [1, 2], 1, YEAR_FINAL_DATE)]);
  await insertYearTournaments([
    {
      index: 1,
      columns: {
        ...DRAWN_COLUMNS,
        status: 'finished',
        firstRoundDate: YEAR_FINAL_DATE,
        participantCount: 2,
        outcome: 'awarded',
        championEntryId: yearEntryIdOf(1),
        awardedAt: AFTER_FINAL,
      },
    },
  ]);
}

// 参加2の決勝が両者の失格で終わり、受賞なしで終了した2027年
async function seedNoAwardYear(): Promise<void> {
  await insertUser(OWNER);
  await insertProducts([1, 2], OWNER);
  const forfeited = { result: 'lost', upvoteCount: 0 } as const;
  await insertMatches([
    decidedMatch(
      1,
      YEAR_FINAL_DATE,
      [side(11, 1, OWNER, forfeited), side(12, 2, OWNER, forfeited)],
      'both_forfeited',
    ),
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
        outcome: 'no_award',
      },
    },
  ]);
  await insertYearParticipants([1, 2]);
  await insertBracketMatches([
    decidedNode(1, 1, [1, 2], null, YEAR_FINAL_DATE),
  ]);
  await insertYearTournaments([
    {
      index: 1,
      columns: {
        ...DRAWN_COLUMNS,
        status: 'finished',
        firstRoundDate: YEAR_FINAL_DATE,
        participantCount: 2,
        outcome: 'no_award',
        awardedAt: AFTER_FINAL,
      },
    },
  ]);
}

describe('yearBracket', () => {
  test('ラウンドごとのマッチと未来の枠をtournament-weekのブラケットの型で返し、表示できないプロダクトとシードの未来の枠はプロダクトを出さない', async () => {
    await seedFirstRoundDecided();
    setYearTestNow(AFTER_FIRST_ROUND);

    const response = await fetchYearBracket(YEAR_KEY);

    expect(response.errors).toBeUndefined();
    const bracket = response.data?.yearBracket;
    expect(bracket?.tournament).toEqual({
      year: YEAR,
      label: '2027年',
      finalDate: YEAR_FINAL_DATE,
      firstRoundDate: FIRST_ROUND_DATE,
      status: 'IN_PROGRESS',
      awarded: null,
    });
    expect(bracket?.participantCount).toBe(6);
    expect(bracket?.seedCount).toBe(2);
    expect(bracket?.champion).toBeNull();
    expect(bracket?.rounds).toEqual([
      {
        round: 1,
        name: '1回戦',
        date: FIRST_ROUND_DATE,
        nodes: [
          {
            position: 1,
            match: {
              id: matchIdOf(1),
              kind: 'YEAR',
              phase: 'FINISHED',
              decision: 'VOTES',
            },
            slots: [
              {
                participantNo: 3,
                ...EMPTY_SLOT_FIELDS,
                product: { handle: 'product3', name: 'プロダクト3' },
                upvoteCount: 7,
                result: 'WON',
              },
              {
                participantNo: 4,
                ...EMPTY_SLOT_FIELDS,
                product: { handle: 'product4', name: 'プロダクト4' },
                upvoteCount: 2,
                result: 'LOST',
              },
            ],
          },
          {
            position: 2,
            match: {
              id: matchIdOf(2),
              kind: 'YEAR',
              phase: 'FINISHED',
              decision: 'VOTES',
            },
            slots: [
              {
                participantNo: 5,
                ...EMPTY_SLOT_FIELDS,
                product: { handle: 'product5', name: 'プロダクト5' },
                upvoteCount: 7,
                result: 'WON',
              },
              {
                participantNo: HIDDEN_LOSER,
                ...EMPTY_SLOT_FIELDS,
                product: null,
                upvoteCount: 2,
                result: 'LOST',
              },
            ],
          },
        ],
      },
      {
        round: 2,
        name: '準決勝',
        date: SEMIFINAL_DATE,
        nodes: [
          {
            position: 1,
            match: null,
            slots: [
              { participantNo: 1, seed: 1, feedLabel: 'シード1', ...NO_RESULT },
              {
                participantNo: 5,
                seed: null,
                feedLabel: '1回戦第2試合の勝者',
                ...NO_RESULT,
              },
            ],
          },
          {
            position: 2,
            match: null,
            slots: [
              { participantNo: 2, seed: 2, feedLabel: 'シード2', ...NO_RESULT },
              {
                participantNo: 3,
                seed: null,
                feedLabel: '1回戦第1試合の勝者',
                ...NO_RESULT,
              },
            ],
          },
        ],
      },
      {
        round: 3,
        name: '決勝',
        date: YEAR_FINAL_DATE,
        nodes: [
          {
            position: 1,
            match: null,
            slots: [
              {
                participantNo: null,
                seed: null,
                feedLabel: '準決勝第1試合の勝者',
                ...NO_RESULT,
              },
              {
                participantNo: null,
                seed: null,
                feedLabel: '準決勝第2試合の勝者',
                ...NO_RESULT,
              },
            ],
          },
        ],
      },
    ]);
  });

  test('受賞した年は、優勝のプロダクトを返しawardedを真にする', async () => {
    await seedAwardedYear('visible');
    setYearTestNow(AFTER_FINAL);

    const response = await fetchYearBracket(YEAR_KEY);

    expect(response.errors).toBeUndefined();
    const bracket = response.data?.yearBracket;
    expect(bracket?.tournament).toMatchObject({
      status: 'FINISHED',
      awarded: true,
    });
    expect(bracket?.champion).toEqual({
      handle: 'product1',
      name: 'プロダクト1',
      tagline: 'タグライン1',
      category: expect.objectContaining({
        id: PRODUCT_CATEGORY_OTHER_ID,
      }) as never,
      websiteUrl: 'https://product1.example/',
      logo: null,
      listed: true,
    });
  });

  test.each(['hidden', 'deleted', 'suspended'] as const)(
    '受賞した年で優勝のプロダクトが表示できない(%s)ときは、championをnullにしてawardedを真にする',
    async (visibility) => {
      await seedAwardedYear(visibility);
      setYearTestNow(AFTER_FINAL);

      const response = await fetchYearBracket(YEAR_KEY);

      expect(response.errors).toBeUndefined();
      const bracket = response.data?.yearBracket;
      expect(bracket?.champion).toBeNull();
      expect(bracket?.tournament).toMatchObject({
        status: 'FINISHED',
        awarded: true,
      });
      expect(bracket?.rounds[0]?.nodes[0]?.slots[0]).toMatchObject({
        participantNo: 1,
        product: null,
        result: 'WON',
      });
    },
  );

  test('受賞なしで終了した年は、championをnullにしてawardedを偽にする', async () => {
    await seedNoAwardYear();
    setYearTestNow(AFTER_FINAL);

    const response = await fetchYearBracket(YEAR_KEY);

    expect(response.errors).toBeUndefined();
    expect(response.data?.yearBracket?.champion).toBeNull();
    expect(response.data?.yearBracket?.tournament).toMatchObject({
      status: 'FINISHED',
      awarded: false,
    });
  });

  test.each(['2028', '2026', '27', '20270', 'abcd', ''])(
    '行の無い年・組み合わせを決定していない年・4桁でない年(%s)はnullにする',
    async (year) => {
      await seedFirstRoundDecided();
      await insertYearTournaments([{ index: 2, year: 2026 }]);

      const response = await fetchYearBracket(year);

      expect(response.errors).toBeUndefined();
      expect(response.data?.yearBracket).toBeNull();
    },
  );

  test('記録済みのマッチの表示を1回のまとめた読み取りで引く', async () => {
    await seedFirstRoundDecided();
    setYearTestNow(AFTER_FIRST_ROUND);
    const findViews = vi.spyOn(DirectoryMatchViewReader.prototype, 'findViews');

    const response = await fetchYearBracket(YEAR_KEY);

    expect(response.errors).toBeUndefined();
    expect(findViews).toHaveBeenCalledTimes(1);
    expect(findViews.mock.calls[0]?.[0].matchIds.toSorted()).toEqual(
      [1, 2].map(matchIdOf).toSorted(),
    );
  });

  test('管理者側の呼び出し元からの要求はforbiddenで拒否する', async () => {
    const response = await fetchYearBracket(YEAR_KEY, { caller: 'admin' });

    expect(response.errors?.map((error) => error.extensions?.code)).toEqual([
      'forbidden',
    ]);
  });
});
