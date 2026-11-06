import { describe, expect, test } from 'bun:test';

import {
  auditLogFilterScopeOf,
  auditLogSearchAt,
  auditLogVariablesOf,
  normalizeTargetId,
  toAuditLogSearch,
} from './audit-log-search.ts';

const ADMIN_ID = '01JC0ADMIN000000000000000001';
const ULID = '01JC0B3K7Q9X2ZR4TVWYHNM5PD';
const USER_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

const UNSPECIFIED_SEARCH = {
  operator: undefined,
  action: undefined,
  target: undefined,
  from: undefined,
  to: undefined,
  after: undefined,
};

describe('toAuditLogSearch', () => {
  test('絞り込みの条件とページの位置を検索パラメータから取り出す', () => {
    expect(
      toAuditLogSearch({
        operator: ADMIN_ID,
        action: 'admin-account.invite',
        target: USER_ID,
        from: '2026-11-01',
        to: '2026-11-04',
        after: 'cursor-1',
      }),
    ).toStrictEqual({
      operator: ADMIN_ID,
      action: 'admin-account.invite',
      target: USER_ID,
      from: '2026-11-01',
      to: '2026-11-04',
      after: 'cursor-1',
    });
  });

  test('空・上限を超える・暦に無い・文字列でない値は、ルーターがURLの元の値を残さないよう項目をundefinedにし、知らない項目を落とす', () => {
    expect(
      toAuditLogSearch({
        operator: '',
        action: 'a'.repeat(65),
        target: 123,
        from: '2026-02-30',
        to: '20261104',
        after: 'c'.repeat(257),
        page: 2,
      }),
    ).toStrictEqual(UNSPECIFIED_SEARCH);
  });

  test('期間の境界の時刻がAPIの日時の外になり得る年の日付は、未指定として落とす', () => {
    expect(
      toAuditLogSearch({ from: '0000-01-01', to: '9999-12-31' }),
    ).toStrictEqual(UNSPECIFIED_SEARCH);
  });

  test('上限ちょうどの条件とカーソルは受け付ける', () => {
    const action = 'a'.repeat(64);
    const after = 'c'.repeat(256);
    expect(toAuditLogSearch({ action, after })).toStrictEqual({
      ...UNSPECIFIED_SEARCH,
      action,
      after,
    });
  });
});

describe('normalizeTargetId', () => {
  test('前後の空白を除き、UUIDは小文字に、ULIDは大文字に揃える', () => {
    expect(normalizeTargetId(`  ${USER_ID.toUpperCase()}\u3000`)).toBe(USER_ID);
    expect(normalizeTargetId(ULID.toLowerCase())).toBe(ULID);
  });

  test('UUIDとULIDの形でない値は空白を除くだけにする', () => {
    expect(normalizeTargetId(' Product-ID ')).toBe('Product-ID');
    expect(normalizeTargetId('   ')).toBe('');
  });
});

describe('auditLogVariablesOf', () => {
  test('条件を検索の引数に写し、期間を閲覧者の地域の時刻にし、対象の識別子を揃える', () => {
    expect(
      auditLogVariablesOf(
        {
          operator: ADMIN_ID,
          action: 'admin-account.delete',
          target: USER_ID.toUpperCase(),
          from: '2026-11-01',
          to: '2026-11-04',
          after: 'cursor-1',
        },
        'Asia/Tokyo',
      ),
    ).toStrictEqual({
      filter: {
        operatorId: ADMIN_ID,
        action: 'admin-account.delete',
        targetId: USER_ID,
        occurredFrom: '2026-10-31T15:00:00.000Z',
        occurredBefore: '2026-11-04T15:00:00.000Z',
      },
      after: 'cursor-1',
    });
  });

  test('条件が無ければ空の絞り込みで1ページ目を求める', () => {
    expect(auditLogVariablesOf({}, 'UTC')).toStrictEqual({ filter: {} });
  });

  test('空白だけの対象の識別子は未指定にする', () => {
    expect(auditLogVariablesOf({ target: '  ' }, 'UTC')).toStrictEqual({
      filter: {},
    });
  });
});

describe('auditLogFilterScopeOf', () => {
  test('ページの位置を除いた条件が同じなら同じ値になり、項目の順に依らない', () => {
    expect(
      auditLogFilterScopeOf({ action: 'a', operator: 'b', after: 'x' }),
    ).toBe(auditLogFilterScopeOf({ operator: 'b', action: 'a' }));
  });

  test('条件が変われば異なる値になる', () => {
    expect(auditLogFilterScopeOf({ action: 'a' })).not.toBe(
      auditLogFilterScopeOf({ action: 'b' }),
    );
    expect(auditLogFilterScopeOf({ from: '2026-11-01' })).not.toBe(
      auditLogFilterScopeOf({ to: '2026-11-01' }),
    );
  });
});

describe('auditLogSearchAt', () => {
  test('条件を保ったままページの位置を替え、undefinedなら1ページ目にする', () => {
    const search = { action: 'a', target: 't', after: 'x' };

    expect(auditLogSearchAt(search, 'y')).toStrictEqual({
      action: 'a',
      target: 't',
      after: 'y',
    });
    expect(auditLogSearchAt(search, undefined)).toStrictEqual({
      action: 'a',
      target: 't',
    });
  });
});
