import { describe, expect, test, vi } from 'vitest';

import { PRODUCT_CATEGORY_OTHER_ID } from '../../../../../common-lib/product/product-category-constants.ts';
import { formatWeekPeriodLabel } from '../../../../../common-lib/tournament/week-period.ts';
import { matchWindow } from '../../../../../lib/core/match/match-model.ts';
import { parseBusinessDate } from '../../../../../lib/core/time/business-time.ts';
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
  insertWeekTournaments,
  weekEntryIdOf,
} from '../../../../../lib/workers/week-tournament/testing/week-tournament-fixtures.ts';
import {
  fetchConsumerBracketRounds,
  fetchWeekBracket,
  installWeekTournamentGraphQLTest,
} from '../../../../../test/support/week-tournament-graphql-operations.ts';
import { DirectoryMatchViewReader } from '../../../../application/match/match-view-reader.ts';

installWeekTournamentGraphQLTest();

const OWNER = 1;

const WEEK = '2026-W47';

const FIRST_ROUND_DATE = '2026-11-22';

const FINAL_DATE = '2026-11-23';

const HIDDEN_PRODUCT = 3;

const DECIDED_AT = new Date('2026-11-24T07:40:00.000Z');

function side(
  index: number,
  product: number,
  columns: EntryFixture['columns'] = {},
): EntryFixture {
  return { index, launch: null, product, owner: OWNER, columns };
}

function decidedMatch(
  index: number,
  kind: 'week' | 'year',
  round: number,
  date: string,
  entries: readonly EntryFixture[],
): MatchFixture {
  const window = matchWindow(parseBusinessDate(date));
  return {
    index,
    columns: {
      kind,
      round,
      matchDate: date,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      startedAt: window.startsAt,
      decidedAt: window.endsAt,
      decision: 'votes',
    },
    entries,
  };
}

function decidedNode(
  index: number,
  bracket: number,
  round: number,
  position: number,
  participantNos: readonly [number, number],
  winner: number,
): BracketMatchFixture {
  return {
    index,
    bracket,
    round,
    position,
    participantNos,
    columns: {
      matchId: matchIdOf(index),
      matchDate: round === 1 ? FIRST_ROUND_DATE : FINAL_DATE,
      status: 'decided',
      winnerParticipantNo: winner,
    },
  };
}

// 2026-11-16の週の参加4の終了したブラケット。1回戦は1対2(1の勝利)・3対4(3の勝利、3は非公開化中)、決勝は1対3で1が優勝した
async function seedFinishedBracket(
  championProductHidden: boolean,
): Promise<void> {
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertProducts([2, 4], OWNER);
  await insertProducts(
    [1],
    OWNER,
    championProductHidden ? { hiddenAt: T0 } : {},
  );
  await insertProducts([HIDDEN_PRODUCT], OWNER, { hiddenAt: T0 });
  await insertLaunch(1, 1, { outcome: 'won' });
  const won = { result: 'won', upvoteCount: 5 } as const;
  const lost = { result: 'lost', upvoteCount: 2 } as const;
  await insertMatches([
    decidedMatch(1, 'week', 1, FIRST_ROUND_DATE, [
      side(11, 1, won),
      side(12, 2, lost),
    ]),
    decidedMatch(2, 'week', 1, FIRST_ROUND_DATE, [
      side(21, 3, won),
      side(22, 4, lost),
    ]),
    decidedMatch(3, 'week', 2, FINAL_DATE, [
      side(31, 1, won),
      side(32, 3, lost),
    ]),
  ]);
  await insertBrackets([
    {
      index: 1,
      participantCount: 4,
      columns: {
        firstRoundDate: FIRST_ROUND_DATE,
        status: 'finished',
        outcome: 'champion',
        championParticipantNo: 1,
      },
    },
  ]);
  await insertParticipants(
    [1, 2, 3, 4].map((no) => ({
      index: no,
      bracket: 1,
      participantNo: no,
      entry: no,
      launch: null,
      product: no,
      owner: OWNER,
    })),
  );
  await insertBracketMatches([
    decidedNode(1, 1, 1, 1, [1, 2], 1),
    decidedNode(2, 1, 1, 2, [3, 4], 3),
    decidedNode(3, 1, 2, 1, [1, 3], 1),
  ]);
  await insertWeekTournaments([
    {
      index: 1,
      columns: {
        status: 'finished',
        bracketId: bracketIdOf(1),
        outcome: 'awarded',
        championEntryId: weekEntryIdOf(1),
        awardedAt: DECIDED_AT,
      },
    },
  ]);
}

const EMPTY_SLOT_FIELDS = { feedLabel: null, seed: null };

describe('weekBracket', () => {
  test('ラウンドごとのマッチと側の枠を返し、表示できないプロダクトの枠は名前を出さずnullにする', async () => {
    await seedFinishedBracket(false);

    const response = await fetchWeekBracket(WEEK);

    expect(response.errors).toBeUndefined();
    const bracket = response.data?.weekBracket;
    expect(bracket?.tournament).toEqual({
      week: WEEK,
      label: formatWeekPeriodLabel('2026-11-16'),
      firstRoundDate: FIRST_ROUND_DATE,
      finalDate: FINAL_DATE,
      status: 'FINISHED',
      awarded: true,
    });
    expect(bracket?.participantCount).toBe(4);
    expect(bracket?.seedCount).toBe(0);
    expect(bracket?.rounds).toEqual([
      {
        round: 1,
        name: '準決勝',
        date: FIRST_ROUND_DATE,
        nodes: [
          {
            position: 1,
            match: {
              id: matchIdOf(1),
              kind: 'WEEK',
              phase: 'FINISHED',
              decision: 'VOTES',
            },
            slots: [
              {
                participantNo: 1,
                ...EMPTY_SLOT_FIELDS,
                product: { handle: 'product1', name: 'プロダクト1' },
                upvoteCount: 5,
                result: 'WON',
              },
              {
                participantNo: 2,
                ...EMPTY_SLOT_FIELDS,
                product: { handle: 'product2', name: 'プロダクト2' },
                upvoteCount: 2,
                result: 'LOST',
              },
            ],
          },
          {
            position: 2,
            match: {
              id: matchIdOf(2),
              kind: 'WEEK',
              phase: 'FINISHED',
              decision: 'VOTES',
            },
            slots: [
              {
                participantNo: 3,
                ...EMPTY_SLOT_FIELDS,
                product: null,
                upvoteCount: 5,
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
        ],
      },
      {
        round: 2,
        name: '決勝',
        date: FINAL_DATE,
        nodes: [
          {
            position: 1,
            match: {
              id: matchIdOf(3),
              kind: 'WEEK',
              phase: 'FINISHED',
              decision: 'VOTES',
            },
            slots: [
              {
                participantNo: 1,
                ...EMPTY_SLOT_FIELDS,
                product: { handle: 'product1', name: 'プロダクト1' },
                upvoteCount: 5,
                result: 'WON',
              },
              {
                participantNo: 3,
                ...EMPTY_SLOT_FIELDS,
                product: null,
                upvoteCount: 2,
                result: 'LOST',
              },
            ],
          },
        ],
      },
    ]);
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

  test('優勝したプロダクトが表示できない終了済みのトーナメントは、championをnullにしてawardedを真にする', async () => {
    await seedFinishedBracket(true);

    const response = await fetchWeekBracket(WEEK);

    expect(response.errors).toBeUndefined();
    expect(response.data?.weekBracket?.champion).toBeNull();
    expect(response.data?.weekBracket?.tournament.awarded).toBe(true);
    expect(response.data?.weekBracket?.tournament.status).toBe('FINISHED');
  });

  test.each(['2026-W48', '2026-W60', '2026-47', 'not-a-week', ''])(
    '組み合わせの無い週・存在しない週・形式の違反(%s)はnullにする',
    async (week) => {
      await seedFinishedBracket(false);
      await insertWeekTournaments([{ index: 2, weekStart: '2026-11-23' }]);

      const response = await fetchWeekBracket(week);

      expect(response.errors).toBeUndefined();
      expect(response.data?.weekBracket).toBeNull();
    },
  );

  test('記録済みのマッチの表示を、ローカルD1から90件ずつ読む', async () => {
    const count = 91;
    await insertBrackets([{ index: 1, participantCount: 256 }]);
    await insertBracketMatches(
      Array.from({ length: count }, (_, offset) => ({
        index: offset + 1,
        bracket: 1,
        round: 1,
        position: offset + 1,
        participantNos: [offset * 2 + 1, offset * 2 + 2] as const,
        columns: { matchId: matchIdOf(offset + 1) },
      })),
    );
    await insertWeekTournaments([
      {
        index: 1,
        columns: { status: 'in_progress', bracketId: bracketIdOf(1) },
      },
    ]);
    const findViews = vi.spyOn(DirectoryMatchViewReader.prototype, 'findViews');

    const response = await fetchWeekBracket(WEEK);

    expect(response.errors).toBeUndefined();
    expect(
      findViews.mock.calls.map(([input]) => input.matchIds.length),
    ).toEqual([90, 1]);
    expect(response.data?.weekBracket?.rounds[0]?.nodes).toHaveLength(count);
  });

  test('管理者側の呼び出し元からの要求はforbiddenで拒否する', async () => {
    const response = await fetchWeekBracket(WEEK, { caller: 'admin' });

    expect(response.errors?.map((error) => error.extensions?.code)).toEqual([
      'forbidden',
    ]);
  });
});

describe('BracketRound', () => {
  test('WeekBracketを介さず、buildBracketRoundsViewの値だけからラウンド・位置・側の枠を解決する', async () => {
    await insertUser(OWNER, { emailVerifiedAt: T0 });
    await insertProducts([1, 2], OWNER);
    await insertMatches([
      decidedMatch(1, 'year', 1, FIRST_ROUND_DATE, [
        side(11, 1, { result: 'won', upvoteCount: 3 }),
        side(12, 2, { result: 'lost', upvoteCount: 1 }),
      ]),
    ]);
    await insertBrackets([
      {
        index: 9,
        kind: 'year',
        participantCount: 2,
        columns: { firstRoundDate: FIRST_ROUND_DATE },
      },
    ]);
    await insertBracketMatches([decidedNode(1, 9, 1, 1, [1, 2], 1)]);

    const response = await fetchConsumerBracketRounds(bracketIdOf(9));

    expect(response.errors).toBeUndefined();
    expect(response.data?.consumerBracketRounds).toEqual([
      {
        round: 1,
        name: '決勝',
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
                participantNo: 1,
                ...EMPTY_SLOT_FIELDS,
                product: { handle: 'product1', name: 'プロダクト1' },
                upvoteCount: 3,
                result: 'WON',
              },
              {
                participantNo: 2,
                ...EMPTY_SLOT_FIELDS,
                product: { handle: 'product2', name: 'プロダクト2' },
                upvoteCount: 1,
                result: 'LOST',
              },
            ],
          },
        ],
      },
    ]);
  });
});
