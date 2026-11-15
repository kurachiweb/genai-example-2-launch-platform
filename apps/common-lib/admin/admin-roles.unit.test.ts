import { describe, expect, test } from 'bun:test';

import {
  ADMIN_ROLE_LABELS,
  ADMIN_ROLES,
  type AdminRole,
  hasRole,
} from './admin-roles.ts';

describe('ADMIN_ROLES', () => {
  test('閲覧のみ・モデレーター・最上位管理者の昇順に並ぶ', () => {
    expect([...ADMIN_ROLES]).toEqual(['viewer', 'moderator', 'super_admin']);
  });

  test('一覧は変更できない', () => {
    expect(Object.isFrozen(ADMIN_ROLES)).toBe(true);
  });
});

describe('hasRole', () => {
  test.each<[AdminRole, AdminRole, boolean]>([
    ['viewer', 'viewer', true],
    ['viewer', 'moderator', false],
    ['viewer', 'super_admin', false],
    ['moderator', 'viewer', true],
    ['moderator', 'moderator', true],
    ['moderator', 'super_admin', false],
    ['super_admin', 'viewer', true],
    ['super_admin', 'moderator', true],
    ['super_admin', 'super_admin', true],
  ])(
    '%sが%s以上のロールを持つかの判定が%pになる',
    (actual, minimum, expected) => {
      expect(hasRole(actual, minimum)).toBe(expected);
    },
  );
});

describe('ADMIN_ROLE_LABELS', () => {
  test('各ロールの表示名が要件の呼び方になる', () => {
    expect(ADMIN_ROLE_LABELS).toEqual({
      viewer: '閲覧のみ',
      moderator: 'モデレーター',
      super_admin: '最上位管理者',
    });
  });

  test('表示名の対応は変更できない', () => {
    expect(Object.isFrozen(ADMIN_ROLE_LABELS)).toBe(true);
  });
});
