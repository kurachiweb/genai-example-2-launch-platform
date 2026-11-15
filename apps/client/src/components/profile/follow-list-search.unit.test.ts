import { describe, expect, test } from 'bun:test';

import {
  followListDirectionOf,
  followListTabQueryValue,
  toFollowListSearch,
} from './follow-list-search.ts';

describe('toFollowListSearch', () => {
  test('followersはそのまま返す', () => {
    expect(toFollowListSearch({ tab: 'followers' })).toStrictEqual({
      tab: 'followers',
    });
  });

  test('tabが無ければundefinedの項目を返す', () => {
    expect(toFollowListSearch({})).toStrictEqual({ tab: undefined });
  });

  test('既定のタブを明示したfollowingは省略と同じに扱う', () => {
    expect(toFollowListSearch({ tab: 'following' })).toStrictEqual({
      tab: undefined,
    });
  });

  test.each([
    ['未登録の識別子', 'launches'],
    ['空文字', ''],
    ['大文字を含む', 'Followers'],
    ['文字列でない', 3],
    ['配列', ['followers']],
    ['null', null],
  ])('不正な値(%s)は欠落と同じに扱う', (_label, tab) => {
    expect(toFollowListSearch({ tab })).toStrictEqual({ tab: undefined });
  });

  test('他のクエリはこの検証の結果に含めない', () => {
    expect(
      toFollowListSearch({ tab: 'followers', utm_source: 'x' }),
    ).toStrictEqual({ tab: 'followers' });
  });
});

describe('followListDirectionOf', () => {
  test('followersはフォロワー、それ以外はフォロー中の一覧にする', () => {
    expect(followListDirectionOf('followers')).toBe('followers');
    expect(followListDirectionOf(undefined)).toBe('following');
  });
});

describe('followListTabQueryValue', () => {
  test('既定のフォロー中はクエリから省き、フォロワーはfollowersにする', () => {
    expect(followListTabQueryValue('following')).toBeUndefined();
    expect(followListTabQueryValue('followers')).toBe('followers');
  });
});
