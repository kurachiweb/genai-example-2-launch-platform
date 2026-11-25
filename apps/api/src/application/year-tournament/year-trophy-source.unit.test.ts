import { describe, expect, test } from 'bun:test';

import type {
  YearProductAward,
  YearTournamentStore,
} from '../../../lib/core/year-tournament/ports.ts';
import { YearTrophySource } from './year-trophy-source.ts';

const PRODUCT_ID = '01JF0YPRDT0000000000000001';

function awardOf(year: number, awardedAt: string): YearProductAward {
  return {
    productId: PRODUCT_ID,
    launchId: `01JF0YLNCH${String(year).padStart(16, '0')}`,
    year,
    awardedAt: new Date(awardedAt),
  };
}

function storeOf(awards: readonly YearProductAward[]) {
  const calls: (readonly string[])[] = [];
  const store: Pick<YearTournamentStore, 'listAwardsByProducts'> = {
    listAwardsByProducts: (productIds) => {
      calls.push(productIds);
      return Promise.resolve(awards);
    },
  };
  return { store, calls };
}

describe('YearTrophySource.listTrophies', () => {
  test('そのプロダクトだけの受賞を1回で読み、受賞ごとに対象年の表記と受賞日とブラケットへのパスのトロフィーにする', async () => {
    const { store, calls } = storeOf([
      awardOf(2026, '2026-12-30T14:45:00.000Z'),
      awardOf(2027, '2027-12-29T14:45:00.000Z'),
    ]);
    const source = new YearTrophySource(store);

    const trophies = await source.listTrophies(PRODUCT_ID);

    expect(calls).toStrictEqual([[PRODUCT_ID]]);
    expect(trophies).toStrictEqual([
      {
        kind: 'year',
        period: '2026',
        periodLabel: '2026年',
        awardedAt: new Date('2026-12-30T14:45:00.000Z'),
        bracketPath: '/tournaments/year/2026',
      },
      {
        kind: 'year',
        period: '2027',
        periodLabel: '2027年',
        awardedAt: new Date('2027-12-29T14:45:00.000Z'),
        bracketPath: '/tournaments/year/2027',
      },
    ]);
  });

  test('受賞の無いプロダクトは空の一覧を返す', async () => {
    const { store } = storeOf([]);
    const source = new YearTrophySource(store);

    expect(await source.listTrophies(PRODUCT_ID)).toStrictEqual([]);
  });

  test('照会の失敗はそのまま投げ、照会の部品が供給元の欠落にする', async () => {
    const failure = new Error('D1の失敗');
    const store: Pick<YearTournamentStore, 'listAwardsByProducts'> = {
      listAwardsByProducts: () => Promise.reject(failure),
    };
    const source = new YearTrophySource(store);

    const outcome = source.listTrophies(PRODUCT_ID);

    expect(await outcome.catch((error: unknown) => error)).toBe(failure);
  });
});
