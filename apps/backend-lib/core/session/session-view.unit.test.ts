import { describe, expect, expectTypeOf, test } from 'bun:test';

import type {
  AuthenticatedPrincipal,
  Principal,
  SessionSubjectKind,
  SessionView,
} from './session-view.ts';

describe('SessionView', () => {
  test('同じ要求のセッションの主体を読み取りだけの形で返す', async () => {
    const principal: Principal = {
      kind: 'authenticated',
      subjectKind: 'user',
      subjectId: '01JC0USER00000000000000001',
      sessionId: '01JC0SESSION00000000000001',
    };
    const session: SessionView = {
      principal: () => Promise.resolve(principal),
    };

    expect(await session.principal()).toBe(principal);
    expectTypeOf<SessionView>().toEqualTypeOf<{
      principal(): Promise<Principal>;
    }>();
  });
});

describe('Principal', () => {
  test('未ログインか、主体の種類とIDと保存済みセッションのIDを持つログイン済みのどちらかである', () => {
    expectTypeOf<SessionSubjectKind>().toEqualTypeOf<'user' | 'admin'>();
    expectTypeOf<AuthenticatedPrincipal>().toEqualTypeOf<{
      readonly kind: 'authenticated';
      readonly subjectKind: SessionSubjectKind;
      readonly subjectId: string;
      readonly sessionId: string;
    }>();
    expectTypeOf<Principal>().toEqualTypeOf<
      { readonly kind: 'anonymous' } | AuthenticatedPrincipal
    >();
  });
});
