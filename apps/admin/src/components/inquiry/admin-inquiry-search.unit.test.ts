import { describe, expect, test } from 'bun:test';

import {
  adminInquiryFilterScopeOf,
  adminInquirySearchAt,
  adminInquiryVariablesOf,
  toAdminInquirySearch,
} from './admin-inquiry-search.ts';
import { toInquiryPeriod } from './inquiry-period.ts';

const CATEGORY_ID = '01JC0CATEGORY0000000000001';

describe('toAdminInquirySearch', () => {
  test('ステータス・種別・カテゴリ・受付日の期間とページの位置を検索パラメータから取り出す', () => {
    expect(
      toAdminInquirySearch({
        status: 'OPEN',
        kind: 'GUEST',
        category: CATEGORY_ID,
        from: '2026-11-01',
        to: '2026-11-04',
        after: 'cursor-1',
      }),
    ).toStrictEqual({
      status: 'OPEN',
      kind: 'GUEST',
      category: CATEGORY_ID,
      from: '2026-11-01',
      to: '2026-11-04',
      after: 'cursor-1',
    });
  });

  test('知らないステータス・種別、空・上限を超える値、暦に無い日付と知らない項目を落とす', () => {
    expect(
      toAdminInquirySearch({
        status: 'open',
        kind: 'USER',
        category: 'c'.repeat(65),
        from: '2026-02-30',
        to: '9999-12-31',
        after: 'c'.repeat(257),
        page: 2,
      }),
    ).toStrictEqual({});
    expect(toAdminInquirySearch({ category: '', after: '' })).toStrictEqual({});
  });

  test('上限ちょうどのカテゴリのIDとカーソルは受け付ける', () => {
    const category = 'c'.repeat(64);
    const after = 'a'.repeat(256);

    expect(toAdminInquirySearch({ category, after })).toStrictEqual({
      category,
      after,
    });
  });
});

describe('adminInquiryVariablesOf', () => {
  test('条件が無ければ空の絞り込みで1ページ目を求める', () => {
    expect(adminInquiryVariablesOf({}, 'Asia/Tokyo')).toStrictEqual({
      filter: {},
    });
  });

  test('条件をAPIの絞り込みにし、受付日の期間を閲覧者の地域の暦からUTCの範囲へ変える', () => {
    expect(
      adminInquiryVariablesOf(
        {
          status: 'RESOLVED',
          kind: 'MEMBER',
          category: CATEGORY_ID,
          from: '2026-11-01',
          to: '2026-11-04',
          after: 'cursor-2',
        },
        'Asia/Tokyo',
      ),
    ).toStrictEqual({
      filter: {
        status: 'RESOLVED',
        kind: 'MEMBER',
        categoryId: CATEGORY_ID,
        receivedFrom: '2026-10-31T15:00:00.000Z',
        receivedBefore: '2026-11-04T15:00:00.000Z',
      },
      after: 'cursor-2',
    });
  });
});

describe('toInquiryPeriod', () => {
  test('開始日の0時を含み終了日の翌日0時を含まない範囲を、受付日時の絞り込みの名前で返す', () => {
    expect(
      toInquiryPeriod(
        { from: '2026-11-01', to: '2026-11-01' },
        'America/Los_Angeles',
      ),
    ).toStrictEqual({
      receivedFrom: '2026-11-01T07:00:00.000Z',
      receivedBefore: '2026-11-02T08:00:00.000Z',
    });
    expect(toInquiryPeriod({}, 'Asia/Tokyo')).toStrictEqual({});
  });
});

describe('adminInquiryFilterScopeOf・adminInquirySearchAt', () => {
  test('ページの位置だけが異なる条件は同じ範囲になり、条件が異なれば別の範囲になる', () => {
    const search = { status: 'OPEN', kind: 'GUEST' } as const;

    expect(adminInquiryFilterScopeOf({ ...search, after: 'x' })).toBe(
      adminInquiryFilterScopeOf(search),
    );
    expect(adminInquiryFilterScopeOf({ status: 'OPEN' })).not.toBe(
      adminInquiryFilterScopeOf(search),
    );
  });

  test('条件を保ったままページの位置だけを替え、undefinedなら1ページ目にする', () => {
    const search = {
      status: 'OPEN',
      category: CATEGORY_ID,
      after: 'cursor-1',
    } as const;

    expect(adminInquirySearchAt(search, 'cursor-2')).toStrictEqual({
      status: 'OPEN',
      category: CATEGORY_ID,
      after: 'cursor-2',
    });
    expect(adminInquirySearchAt(search, undefined)).toStrictEqual({
      status: 'OPEN',
      category: CATEGORY_ID,
    });
  });
});
