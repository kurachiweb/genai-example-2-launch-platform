import { describe, expect, test } from 'bun:test';

import { ADMIN_ROLES } from '../../common-lib/admin/admin-roles.ts';
import { fromGraphQLAdminRole, toGraphQLAdminRole } from './admin-role.ts';

describe('fromGraphQLAdminRole', () => {
  test('APIのロールの列挙を、判定に使う共有のロールの値へ変える', () => {
    expect(fromGraphQLAdminRole('VIEWER')).toBe('viewer');
    expect(fromGraphQLAdminRole('MODERATOR')).toBe('moderator');
    expect(fromGraphQLAdminRole('SUPER_ADMIN')).toBe('super_admin');
  });
});

describe('toGraphQLAdminRole', () => {
  test('共有のロールの値を、APIへ送るロールの列挙へ変える', () => {
    expect(toGraphQLAdminRole('viewer')).toBe('VIEWER');
    expect(toGraphQLAdminRole('moderator')).toBe('MODERATOR');
    expect(toGraphQLAdminRole('super_admin')).toBe('SUPER_ADMIN');
  });

  test('すべてのロールで、APIの列挙へ変えて戻すと元の値になる', () => {
    expect(
      ADMIN_ROLES.map((role) => fromGraphQLAdminRole(toGraphQLAdminRole(role))),
    ).toEqual([...ADMIN_ROLES]);
  });
});
