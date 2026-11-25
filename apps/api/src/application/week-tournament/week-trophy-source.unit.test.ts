import { describe, expect, test } from 'bun:test';

import {
  type BusinessDate,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import type {
  WeekChampion,
  WeekChampionDirectory,
} from '../../../lib/core/week-tournament/ports.ts';
import { WeekTrophySource } from './week-trophy-source.ts';

const NOW = new Date('2026-11-17T03:00:00.000Z');

const PRODUCT_ID = '01JF0WPRDT0000000000000001';
const OTHER_PRODUCT_ID = '01JF0WPRDT0000000000000002';

function championOf(
  weekStart: string,
  awardedAt: string,
  productId: string = PRODUCT_ID,
): WeekChampion {
  const date: BusinessDate = parseBusinessDate(weekStart);
  return {
    tournamentId: `01JF0WTRNM${weekStart.replaceAll('-', '').padStart(16, '0')}`,
    weekStart: date,
    productId,
    launchId: `01JF0WRNCH${weekStart.replaceAll('-', '').padStart(16, '0')}`,
    ownerUserId: '01JF0WACCT0000000000000001',
    awardedAt: new Date(awardedAt),
  };
}

function directoryOf(champions: readonly WeekChampion[]) {
  const calls: Parameters<WeekChampionDirectory['listChampions']>[0][] = [];
  const directory: WeekChampionDirectory = {
    listChampions: (input) => {
      calls.push(input);
      return Promise.resolve(champions);
    },
  };
  return { directory, calls };
}

const clock = { now: () => NOW };

describe('WeekTrophySource.listTrophies', () => {
  test('起点を置かず照会の時刻までのWeekの受賞を1回で読み、そのプロダクトの受賞を受賞の週の表記とブラケットへのパスのトロフィーにする', async () => {
    const { directory, calls } = directoryOf([
      championOf('2026-09-07', '2026-09-13T14:45:00.000Z'),
      championOf('2026-09-14', '2026-09-20T14:45:00.000Z', OTHER_PRODUCT_ID),
      championOf('2026-10-05', '2026-10-11T14:45:00.000Z'),
    ]);
    const source = new WeekTrophySource(directory, clock);

    const trophies = await source.listTrophies(PRODUCT_ID);

    expect(calls).toStrictEqual([{ awardedFrom: null, awardedBefore: NOW }]);
    expect(trophies).toStrictEqual([
      {
        kind: 'week',
        period: '2026-W37',
        periodLabel: '2026年第37週(9/7〜9/13)',
        awardedAt: new Date('2026-09-13T14:45:00.000Z'),
        bracketPath: '/tournaments/week/2026-W37',
      },
      {
        kind: 'week',
        period: '2026-W41',
        periodLabel: '2026年第41週(10/5〜10/11)',
        awardedAt: new Date('2026-10-11T14:45:00.000Z'),
        bracketPath: '/tournaments/week/2026-W41',
      },
    ]);
  });

  test('年をまたぐ週はISO週の年で表記し、パスも同じISO週にする', async () => {
    const { directory } = directoryOf([
      championOf('2025-12-29', '2026-01-04T14:45:00.000Z'),
      championOf('2026-12-28', '2027-01-03T14:45:00.000Z'),
    ]);
    const source = new WeekTrophySource(directory, clock);

    const trophies = await source.listTrophies(PRODUCT_ID);

    expect(
      trophies.map(({ period, periodLabel, bracketPath }) => ({
        period,
        periodLabel,
        bracketPath,
      })),
    ).toStrictEqual([
      {
        period: '2026-W01',
        periodLabel: '2026年第1週(12/29〜1/4)',
        bracketPath: '/tournaments/week/2026-W01',
      },
      {
        period: '2026-W53',
        periodLabel: '2026年第53週(12/28〜1/3)',
        bracketPath: '/tournaments/week/2026-W53',
      },
    ]);
  });

  test('そのプロダクトの受賞が無ければ空の一覧を返す', async () => {
    const { directory } = directoryOf([
      championOf('2026-09-07', '2026-09-13T14:45:00.000Z', OTHER_PRODUCT_ID),
    ]);
    const source = new WeekTrophySource(directory, clock);

    expect(await source.listTrophies(PRODUCT_ID)).toStrictEqual([]);
  });

  test('照会の失敗はそのまま投げ、照会の部品が供給元の欠落にする', async () => {
    const failure = new Error('D1の失敗');
    const directory: WeekChampionDirectory = {
      listChampions: () => Promise.reject(failure),
    };
    const source = new WeekTrophySource(directory, clock);

    const outcome = source.listTrophies(PRODUCT_ID);

    expect(await outcome.catch((error: unknown) => error)).toBe(failure);
  });
});
