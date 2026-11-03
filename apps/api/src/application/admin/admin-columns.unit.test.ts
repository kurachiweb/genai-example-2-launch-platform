import { describe, expect, expectTypeOf, test } from 'bun:test';

import {
  ADMIN_ROLES,
  type AdminRole,
} from '../../../common-lib/admin/admin-roles.ts';
import { admins } from '../../../db/schema/admin/admins.ts';

// 共用部品はDBディレクトリを読み込めないため、テーブル定義に直書きした値の一覧と共用部品の型の一致を、DBのスキーマを読み込めるapplication層で確かめる
describe('管理者のテーブル定義の値の一覧', () => {
  test('ロールの列の値が共用部品のロールの昇順の一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof admins.role.enumValues)[number]
    >().toEqualTypeOf<AdminRole>();
    expect([...admins.role.enumValues]).toEqual([...ADMIN_ROLES]);
  });
});
