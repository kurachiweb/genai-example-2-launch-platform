import { describe, expect, test } from 'vitest';

import { formatWeekPeriodLabel } from '../../../../../common-lib/tournament/week-period.ts';
import {
  insertLaunch,
  insertProduct,
  insertUser,
  T0,
} from '../../../../../lib/workers/product/testing/product-fixtures.ts';
import {
  insertWeekEntries,
  insertWeekTournaments,
  weekEntryIdOf,
} from '../../../../../lib/workers/week-tournament/testing/week-tournament-fixtures.ts';
import {
  fetchProductTrophies,
  installWeekTournamentGraphQLTest,
} from '../../../../../test/support/week-tournament-graphql-operations.ts';

installWeekTournamentGraphQLTest();

const OWNER = 1;

const CHAMPION = 1;

const NO_TROPHY = 2;

const HIDDEN = 3;

const UNLISTED = 4;

const EARLIER_AWARDED_AT = new Date('2026-11-17T07:40:00.000Z');

const LATER_AWARDED_AT = new Date('2026-11-24T07:40:00.000Z');

// プロダクト1が2026-11-09と2026-11-16の週に受賞し、2026-11-02の週の受賞はプロダクト3(非公開化中)
async function seedTrophies(): Promise<void> {
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertProduct(CHAMPION, OWNER);
  await insertProduct(NO_TROPHY, OWNER);
  await insertProduct(HIDDEN, OWNER, { hiddenAt: T0 });
  await insertProduct(UNLISTED, OWNER);
  for (const [launch, product] of [
    [1, CHAMPION],
    [2, CHAMPION],
    [3, NO_TROPHY],
    [4, HIDDEN],
  ] as const) {
    await insertLaunch(launch, product, { outcome: 'won' });
  }
  const awarded = (entry: number, awardedAt: Date) => ({
    status: 'finished' as const,
    outcome: 'awarded' as const,
    championEntryId: weekEntryIdOf(entry),
    awardedAt,
  });
  await insertWeekTournaments([
    {
      index: 1,
      weekStart: '2026-11-09',
      columns: awarded(1, EARLIER_AWARDED_AT),
    },
    {
      index: 2,
      weekStart: '2026-11-16',
      columns: awarded(2, LATER_AWARDED_AT),
    },
    {
      index: 3,
      weekStart: '2026-11-02',
      columns: awarded(3, EARLIER_AWARDED_AT),
    },
  ]);
  await insertWeekEntries([
    { index: 1, tournament: 1, launch: 1, product: CHAMPION, owner: OWNER },
    { index: 2, tournament: 2, launch: 2, product: CHAMPION, owner: OWNER },
    { index: 3, tournament: 3, launch: 4, product: HIDDEN, owner: OWNER },
  ]);
}

describe('productTrophies', () => {
  test('受賞したプロダクトのトロフィーを、受賞の新しい順に週の表記とブラケットのページの経路を添えて返す', async () => {
    await seedTrophies();

    const response = await fetchProductTrophies('product1');

    expect(response.errors).toBeUndefined();
    expect(response.data?.productTrophies).toEqual([
      {
        kind: 'WEEK',
        period: '2026-W47',
        periodLabel: formatWeekPeriodLabel('2026-11-16'),
        awardedAt: LATER_AWARDED_AT.toISOString(),
        bracketPath: '/tournaments/week/2026-W47',
      },
      {
        kind: 'WEEK',
        period: '2026-W46',
        periodLabel: formatWeekPeriodLabel('2026-11-09'),
        awardedAt: EARLIER_AWARDED_AT.toISOString(),
        bracketPath: '/tournaments/week/2026-W46',
      },
    ]);
  });

  test('受賞の無いプロダクトは空の一覧を返す', async () => {
    await seedTrophies();

    const response = await fetchProductTrophies('product2');

    expect(response.errors).toBeUndefined();
    expect(response.data?.productTrophies).toEqual([]);
  });

  test.each([
    ['非公開化中', 'product3'],
    ['未掲載', 'product4'],
    ['存在しない', 'product9'],
    ['形式の違反', 'Not A Handle'],
  ])(
    '詳細ページを閲覧できないプロダクト(%s)はnullにする',
    async (_label, handle) => {
      await seedTrophies();

      const response = await fetchProductTrophies(handle);

      expect(response.errors).toBeUndefined();
      expect(response.data?.productTrophies).toBeNull();
    },
  );

  test('管理者側の呼び出し元からの要求はforbiddenで拒否する', async () => {
    const response = await fetchProductTrophies('product1', {
      caller: 'admin',
    });

    expect(response.errors?.map((error) => error.extensions?.code)).toEqual([
      'forbidden',
    ]);
  });
});
