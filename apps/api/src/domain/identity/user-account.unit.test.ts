import { describe, expect, test } from 'bun:test';

import {
  canViewOwnProfile,
  checkAccountWritable,
  isVisibleUser,
  type UserAccountSnapshot,
} from './user-account.ts';

const USER_ID = '01JC0USER00000000000000001';
const OTHER_USER_ID = '01JC0USER00000000000000002';
const AT = new Date('2026-11-01T00:00:00.000Z');

const account = (
  overrides: Partial<Omit<UserAccountSnapshot, 'id'>> = {},
): UserAccountSnapshot => ({
  id: USER_ID,
  status: 'active',
  emailVerifiedAt: AT,
  deletedAt: null,
  ...overrides,
});

const ACCOUNTS = {
  active: account(),
  unverified: account({ emailVerifiedAt: null }),
  suspended: account({ status: 'suspended' }),
  withdrawn: account({ deletedAt: AT }),
  suspendedAndWithdrawn: account({ status: 'suspended', deletedAt: AT }),
  suspendedAndUnverified: account({
    status: 'suspended',
    emailVerifiedAt: null,
  }),
} as const;

describe('isVisibleUser', () => {
  test.each([
    { case: '確認済みの利用者', user: ACCOUNTS.active },
    { case: '未確認の利用者', user: ACCOUNTS.unverified },
  ])('退会済みでも停止中でもない$caseは可視である', ({ user }) => {
    expect(isVisibleUser(user)).toBe(true);
  });

  test.each([
    { case: '停止中', user: ACCOUNTS.suspended },
    { case: '退会済み', user: ACCOUNTS.withdrawn },
    { case: '停止中のまま退会済み', user: ACCOUNTS.suspendedAndWithdrawn },
  ])('$caseの利用者は可視でない', ({ user }) => {
    expect(isVisibleUser(user)).toBe(false);
  });
});

describe('canViewOwnProfile', () => {
  test.each([
    { case: '本人', viewer: USER_ID },
    { case: '他の利用者', viewer: OTHER_USER_ID },
    { case: '未ログインの閲覧者', viewer: undefined },
  ])('可視の利用者は$caseが閲覧できる', ({ viewer }) => {
    expect(canViewOwnProfile(ACCOUNTS.active, viewer)).toBe(true);
  });

  test('停止中の利用者は本人だけが閲覧できる', () => {
    expect(canViewOwnProfile(ACCOUNTS.suspended, USER_ID)).toBe(true);
    expect(canViewOwnProfile(ACCOUNTS.suspended, OTHER_USER_ID)).toBe(false);
    expect(canViewOwnProfile(ACCOUNTS.suspended, undefined)).toBe(false);
  });

  test.each([
    { case: '退会済み', user: ACCOUNTS.withdrawn },
    { case: '停止中のまま退会済み', user: ACCOUNTS.suspendedAndWithdrawn },
  ])('$caseの利用者は本人も閲覧できない', ({ user }) => {
    expect(canViewOwnProfile(user, USER_ID)).toBe(false);
  });
});

describe('checkAccountWritable', () => {
  test.each([{ requireVerifiedEmail: true }, { requireVerifiedEmail: false }])(
    '確認済みの可視の利用者は書き込める(確認の要求: $requireVerifiedEmail)',
    (options) => {
      expect(checkAccountWritable(ACCOUNTS.active, options)).toBeUndefined();
    },
  );

  test('未確認の利用者は、確認を要求する書き込みだけを拒否される', () => {
    expect(
      checkAccountWritable(ACCOUNTS.unverified, { requireVerifiedEmail: true }),
    ).toBe('email-not-verified');
    expect(
      checkAccountWritable(ACCOUNTS.unverified, {
        requireVerifiedEmail: false,
      }),
    ).toBeUndefined();
  });

  test.each([{ requireVerifiedEmail: true }, { requireVerifiedEmail: false }])(
    '停止中の利用者は確認の有無によらず停止を理由に拒否される(確認の要求: $requireVerifiedEmail)',
    (options) => {
      expect(checkAccountWritable(ACCOUNTS.suspended, options)).toBe(
        'suspended',
      );
      expect(
        checkAccountWritable(ACCOUNTS.suspendedAndUnverified, options),
      ).toBe('suspended');
    },
  );

  test.each([
    { case: '退会済み', user: ACCOUNTS.withdrawn },
    { case: '停止中のまま退会済み', user: ACCOUNTS.suspendedAndWithdrawn },
  ])('$caseの利用者は退会を理由に拒否される', ({ user }) => {
    expect(checkAccountWritable(user, { requireVerifiedEmail: false })).toBe(
      'withdrawn',
    );
    expect(checkAccountWritable(user, { requireVerifiedEmail: true })).toBe(
      'withdrawn',
    );
  });
});
