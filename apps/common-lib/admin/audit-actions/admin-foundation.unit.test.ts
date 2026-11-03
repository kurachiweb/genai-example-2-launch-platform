import { describe, expect, test } from 'bun:test';

import { createAuditActionCatalog } from '../audit-action.ts';
import {
  ADMIN_ACCOUNT_DELETE_ACTION,
  ADMIN_ACCOUNT_INVITE_ACTION,
  ADMIN_ACCOUNT_ROLE_CHANGE_ACTION,
  ADMIN_FOUNDATION_AUDIT_ACTIONS,
  USER_EMAIL_SEARCH_ACTION,
} from './admin-foundation.ts';

describe('管理者の操作の種別', () => {
  test('管理者の招待は対象が管理者1件で理由が任意、詳細を持たない', () => {
    expect(ADMIN_ACCOUNT_INVITE_ACTION).toEqual({
      name: 'admin-account.invite',
      label: '管理者の招待',
      targetKind: 'admin',
      reason: 'optional',
      detailKeys: [],
      maxTargets: 1,
    });
  });

  test('管理者の削除は対象が管理者1件で理由が任意、詳細を持たない', () => {
    expect(ADMIN_ACCOUNT_DELETE_ACTION).toEqual({
      name: 'admin-account.delete',
      label: '管理者の削除',
      targetKind: 'admin',
      reason: 'optional',
      detailKeys: [],
      maxTargets: 1,
    });
  });

  test('ロールの変更は対象が管理者1件で理由が任意、詳細に変更前後のロールを持つ', () => {
    expect(ADMIN_ACCOUNT_ROLE_CHANGE_ACTION).toEqual({
      name: 'admin-account.role-change',
      label: '管理者のロールの変更',
      targetKind: 'admin',
      reason: 'optional',
      detailKeys: ['fromRole', 'toRole'],
      maxTargets: 1,
    });
  });
});

describe('ユーザーのメールアドレス検索の種別', () => {
  test('対象はユーザーで、対象の上限は100件になる', () => {
    expect(USER_EMAIL_SEARCH_ACTION.name).toBe('user.email-search');
    expect(USER_EMAIL_SEARCH_ACTION.label).toBe('ユーザーのメールアドレス検索');
    expect(USER_EMAIL_SEARCH_ACTION.targetKind).toBe('user');
    expect(USER_EMAIL_SEARCH_ACTION.maxTargets).toBe(100);
  });

  test('理由を受け付けない', () => {
    expect(USER_EMAIL_SEARCH_ACTION.reason).toBe('none');
  });

  test('詳細の鍵を持たず、検索文字列を入れる欄が無い', () => {
    expect(USER_EMAIL_SEARCH_ACTION.detailKeys).toEqual([]);
  });
});

describe('ADMIN_FOUNDATION_AUDIT_ACTIONS', () => {
  test('本specの4種別を招待・削除・ロールの変更・メールアドレス検索の順に持つ', () => {
    expect(ADMIN_FOUNDATION_AUDIT_ACTIONS).toEqual([
      ADMIN_ACCOUNT_INVITE_ACTION,
      ADMIN_ACCOUNT_DELETE_ACTION,
      ADMIN_ACCOUNT_ROLE_CHANGE_ACTION,
      USER_EMAIL_SEARCH_ACTION,
    ]);
  });

  test('例外なくカタログに登録できる', () => {
    expect(() =>
      createAuditActionCatalog(ADMIN_FOUNDATION_AUDIT_ACTIONS),
    ).not.toThrow();
  });

  test('一覧と各定義は凍結されている', () => {
    expect(Object.isFrozen(ADMIN_FOUNDATION_AUDIT_ACTIONS)).toBe(true);
    for (const action of ADMIN_FOUNDATION_AUDIT_ACTIONS) {
      expect(Object.isFrozen(action)).toBe(true);
    }
  });
});
