import { describe, expect, expectTypeOf, test } from 'bun:test';

import {
  ADMIN_ROLES,
  type AdminRole,
} from '../../../common-lib/admin/admin-roles.ts';
import { adminAuthTokens } from '../../../db/schema/admin/admin-auth-tokens.ts';
import { admins } from '../../../db/schema/admin/admins.ts';
import {
  ADMIN_STATUSES,
  type AdminStatus,
} from '../../domain/admin/admin-account.ts';
import {
  ADMIN_AUTH_TOKEN_PURPOSES,
  type AdminAuthTokenPurpose,
} from '../../domain/admin/admin-auth-token-purpose.ts';

// 共用部品とドメイン層はDBディレクトリを読み込めないため、テーブル定義に直書きした値の一覧と共用部品・ドメイン層の型の一致を、DBのスキーマを読み込めるapplication層で確かめる
describe('管理者のテーブル定義の値の一覧', () => {
  test('ロールの列の値が共用部品のロールの昇順の一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof admins.role.enumValues)[number]
    >().toEqualTypeOf<AdminRole>();
    expect([...admins.role.enumValues]).toEqual([...ADMIN_ROLES]);
  });

  test('状態の列の値がドメイン層の状態の一覧と同じになる', () => {
    expectTypeOf<
      (typeof admins.status.enumValues)[number]
    >().toEqualTypeOf<AdminStatus>();
    expect([...admins.status.enumValues]).toEqual([...ADMIN_STATUSES]);
  });

  test('認証系トークンの用途の列の値がドメイン層の用途の一覧と同じになる', () => {
    expectTypeOf<
      (typeof adminAuthTokens.purpose.enumValues)[number]
    >().toEqualTypeOf<AdminAuthTokenPurpose>();
    expect([...adminAuthTokens.purpose.enumValues]).toEqual([
      ...ADMIN_AUTH_TOKEN_PURPOSES,
    ]);
  });
});
