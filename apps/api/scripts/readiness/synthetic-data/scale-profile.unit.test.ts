import { describe, expect, test } from 'bun:test';

import {
  SCALE_PROFILES,
  SMOKE_PROFILE,
  YEAR_ONE_PROFILE,
  assertScaleProfile,
  scaleProfileOf,
} from './scale-profile.ts';

describe('YEAR_ONE_PROFILE', () => {
  test('仮2の想定規模の件数を持つ', () => {
    expect(YEAR_ONE_PROFILE).toEqual({
      name: 'year-one',
      users: 50_000,
      products: 20_000,
      qualifierWins: 100_000,
      comments: 200_000,
      repliesInLargestThread: 500,
      activeSponsorships: 1_000,
      followersOfLargestCreator: 10_000,
      reportCases: 5_000,
      auditLogs: 100_000,
      exportHeavyUsers: 1,
      orphanFiles: 1_200,
      maxLengthHelpArticles: 1,
    });
  });
});

describe('SMOKE_PROFILE', () => {
  test('固定の件数の項目を除いて想定規模の1000分の1にする', () => {
    expect(SMOKE_PROFILE).toEqual({
      name: 'smoke',
      users: 50,
      products: 20,
      qualifierWins: 100,
      comments: 200,
      repliesInLargestThread: 1,
      activeSponsorships: 1,
      followersOfLargestCreator: 10,
      reportCases: 5,
      auditLogs: 100,
      exportHeavyUsers: 1,
      orphanFiles: 1_200,
      maxLengthHelpArticles: 1,
    });
  });

  test('フォロワーが約10人になり、開催通知の収集の対象を確かめられる', () => {
    expect(SMOKE_PROFILE.followersOfLargestCreator).toBe(10);
  });
});

describe('scaleProfileOf', () => {
  test('名前から規模を引く', () => {
    expect(scaleProfileOf('year-one')).toBe(YEAR_ONE_PROFILE);
    expect(scaleProfileOf('smoke')).toBe(SMOKE_PROFILE);
  });

  test('未知の名前は選べる名前を添えて例外にする', () => {
    expect(() => scaleProfileOf('huge')).toThrow(/year-one.*smoke/u);
  });

  test('Objectの継承したプロパティ名は未知として扱う', () => {
    expect(() => scaleProfileOf('constructor')).toThrow();
    expect(Object.keys(SCALE_PROFILES)).toEqual(['year-one', 'smoke']);
  });
});

describe('assertScaleProfile', () => {
  test('両方の規模は検査を通る', () => {
    expect(() => {
      assertScaleProfile(YEAR_ONE_PROFILE);
      assertScaleProfile(SMOKE_PROFILE);
    }).not.toThrow();
  });

  test('フォロワーの数と作り手の1人を足した数が利用者の数を超えると例外にする', () => {
    expect(() => {
      assertScaleProfile({
        ...SMOKE_PROFILE,
        users: 10,
        followersOfLargestCreator: 10,
      });
    }).toThrow(/フォロワー/u);
  });

  test('プロダクトの数が利用者の数を超えると例外にする', () => {
    expect(() => {
      assertScaleProfile({ ...SMOKE_PROFILE, users: 20, products: 21 });
    }).toThrow(/プロダクト/u);
  });

  test('件数が正の整数でなければ例外にする', () => {
    expect(() => {
      assertScaleProfile({ ...SMOKE_PROFILE, users: 0 });
    }).toThrow(/users/u);
    expect(() => {
      assertScaleProfile({ ...SMOKE_PROFILE, comments: 1.5 });
    }).toThrow(/comments/u);
  });
});
