import { describe, expect, expectTypeOf, test } from 'bun:test';

import type { AdminRole } from '../../../common-lib/admin/admin-roles.ts';
import type { CurrentAdmin } from './current-admin.ts';

describe('CurrentAdmin', () => {
  test('認可で有効と確かめた管理者のID・ロール・ニックネーム・セッションのIDを持つ', () => {
    const current: CurrentAdmin = {
      id: '01JBX8Y4Z5ABCDEFGHJKMNPQRS',
      role: 'super_admin',
      nickname: '管理者',
      sessionId: '01JC0SESSION00000000000001',
    };

    expect(current.role).toBe('super_admin');
    expectTypeOf<CurrentAdmin>().toEqualTypeOf<{
      readonly id: string;
      readonly role: AdminRole;
      readonly nickname: string;
      readonly sessionId: string;
    }>();
  });
});
