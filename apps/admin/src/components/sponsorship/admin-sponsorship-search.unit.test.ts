import { describe, expect, test } from 'bun:test';

import {
  ADMIN_SPONSORSHIP_STATUS_FILTERS,
  ADMIN_SPONSORSHIP_TIERS,
  adminSponsorshipFilterScopeOf,
  adminSponsorshipSearchAt,
  adminSponsorshipVariablesOf,
  toAdminSponsorshipSearch,
} from './admin-sponsorship-search.ts';

const UNSPECIFIED_SEARCH = {
  status: undefined,
  tier: undefined,
  after: undefined,
};

describe('toAdminSponsorshipSearch', () => {
  test('掲載状況・ティアとページの位置を検索パラメータから取り出す', () => {
    expect(
      toAdminSponsorshipSearch({
        status: 'SCHEDULED',
        tier: 'GOLD',
        after: 'cursor-1',
      }),
    ).toStrictEqual({ status: 'SCHEDULED', tier: 'GOLD', after: 'cursor-1' });
  });

  test.each(ADMIN_SPONSORSHIP_STATUS_FILTERS)(
    '掲載状況の絞り込み%sを受け付ける',
    (status) => {
      expect(toAdminSponsorshipSearch({ status })).toStrictEqual({
        ...UNSPECIFIED_SEARCH,
        status,
      });
    },
  );

  test.each(ADMIN_SPONSORSHIP_TIERS)('ティア%sを受け付ける', (tier) => {
    expect(toAdminSponsorshipSearch({ tier })).toStrictEqual({
      ...UNSPECIFIED_SEARCH,
      tier,
    });
  });

  test('表示停止中・小文字・知らない掲載状況とティア、空・上限を超える・文字列でないカーソルは、ルーターがURLの元の値を残さないよう項目をundefinedにし、知らない項目を落とす', () => {
    expect(
      toAdminSponsorshipSearch({
        status: 'PAUSED',
        tier: 'gold',
        after: 'c'.repeat(257),
        page: 2,
      }),
    ).toStrictEqual(UNSPECIFIED_SEARCH);
    expect(
      toAdminSponsorshipSearch({
        status: 'scheduled',
        tier: 'BRONZE',
        after: '',
      }),
    ).toStrictEqual(UNSPECIFIED_SEARCH);
    expect(
      toAdminSponsorshipSearch({ status: 1, tier: null, after: 123 }),
    ).toStrictEqual(UNSPECIFIED_SEARCH);
  });

  test('上限ちょうどのカーソルは受け付ける', () => {
    const after = 'c'.repeat(256);

    expect(toAdminSponsorshipSearch({ after })).toStrictEqual({
      ...UNSPECIFIED_SEARCH,
      after,
    });
  });
});

describe('adminSponsorshipVariablesOf', () => {
  test('条件が無ければ空の絞り込みで1ページ目の50件を求める', () => {
    expect(adminSponsorshipVariablesOf({})).toStrictEqual({
      filter: {},
      first: 50,
    });
  });

  test('掲載状況・ティアをAPIの絞り込みにし、ページの位置を続きの位置にする', () => {
    expect(
      adminSponsorshipVariablesOf({
        status: 'ACTIVE',
        tier: 'LEGEND',
        after: 'cursor-2',
      }),
    ).toStrictEqual({
      filter: { status: 'ACTIVE', tier: 'LEGEND' },
      first: 50,
      after: 'cursor-2',
    });
  });

  test('未指定の項目は絞り込みに入れない', () => {
    expect(
      adminSponsorshipVariablesOf({ status: undefined, tier: 'SILVER' }),
    ).toStrictEqual({ filter: { tier: 'SILVER' }, first: 50 });
  });
});

describe('adminSponsorshipFilterScopeOf・adminSponsorshipSearchAt', () => {
  test('ページの位置だけが異なる条件は同じ範囲になり、条件が異なれば別の範囲になる', () => {
    const search = { status: 'ENDED', tier: 'GOLD' } as const;

    expect(adminSponsorshipFilterScopeOf({ ...search, after: 'x' })).toBe(
      adminSponsorshipFilterScopeOf(search),
    );
    expect(adminSponsorshipFilterScopeOf({ status: 'ENDED' })).not.toBe(
      adminSponsorshipFilterScopeOf(search),
    );
    expect(adminSponsorshipFilterScopeOf({ status: 'ENDED' })).not.toBe(
      adminSponsorshipFilterScopeOf({ tier: 'GOLD' }),
    );
  });

  test('条件を保ったままページの位置だけを替え、undefinedなら1ページ目にする', () => {
    const search = { tier: 'SILVER', after: 'cursor-1' } as const;

    expect(adminSponsorshipSearchAt(search, 'cursor-2')).toStrictEqual({
      tier: 'SILVER',
      after: 'cursor-2',
    });
    expect(adminSponsorshipSearchAt(search, undefined)).toStrictEqual({
      tier: 'SILVER',
    });
  });
});
