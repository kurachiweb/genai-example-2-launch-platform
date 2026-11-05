import { describe, expect, expectTypeOf, test } from 'bun:test';

import type {
  AuthenticatedPrincipal,
  SessionView,
} from '../session/session-view.ts';
import type {
  AccountGuard,
  CurrentUser,
  UserAccountView,
} from './account-guard.ts';

const USER: UserAccountView = {
  id: '01JC0USER00000000000000001',
  pseudonymousId: '0b5f8c3e-2d4a-4f6b-9c1e-7a8d9e0f1a2b',
  status: 'active',
  emailVerifiedAt: new Date('2026-11-01T00:00:00.000Z'),
  deletedAt: null,
  email: 'user@mail.example',
  nickname: '利用者',
  handle: 'user',
};

describe('UserAccountView', () => {
  test('状態の判定に使う項目に、ニックネーム・ハンドル・メールアドレス・仮名化IDを加えた読み取りの形で、秘密情報を含まない', () => {
    expectTypeOf<keyof UserAccountView>().toEqualTypeOf<
      | 'id'
      | 'status'
      | 'emailVerifiedAt'
      | 'deletedAt'
      | 'nickname'
      | 'handle'
      | 'email'
      | 'pseudonymousId'
    >();
    expectTypeOf<UserAccountView['status']>().toEqualTypeOf<
      'active' | 'suspended'
    >();
    expect(Object.keys(USER)).not.toContain('passwordHash');
  });
});

describe('AccountGuard', () => {
  test('ログイン中の利用者を、認証済みの主体と利用者の読み取りの形の組で返す', async () => {
    const principal: AuthenticatedPrincipal = {
      kind: 'authenticated',
      subjectKind: 'user',
      subjectId: USER.id,
      sessionId: '01JC0SESSION00000000000001',
    };
    const current: CurrentUser = { principal, user: USER };
    const guard: AccountGuard = {
      currentUser: () => Promise.resolve(current),
      requireUser: () => Promise.resolve(current),
      requireWritableUser: () => Promise.resolve(current),
      requireVerifiedUser: () => Promise.resolve(current),
    };
    const session: SessionView = {
      principal: () => Promise.resolve(principal),
    };

    expect(await guard.requireWritableUser(session)).toBe(current);
    expectTypeOf<CurrentUser['user']>().toEqualTypeOf<UserAccountView>();
    expectTypeOf<ReturnType<AccountGuard['currentUser']>>().toEqualTypeOf<
      Promise<CurrentUser | undefined>
    >();
  });
});
