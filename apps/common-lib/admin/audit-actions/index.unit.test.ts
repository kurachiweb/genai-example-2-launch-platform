import { describe, expect, test } from 'bun:test';

import { createAuditActionCatalog } from '../audit-action.ts';
import { ADMIN_FOUNDATION_AUDIT_ACTIONS } from './admin-foundation.ts';
import { AUDIT_ACTIONS } from './index.ts';

describe('AUDIT_ACTIONS', () => {
  test('集約した全種別を例外なくカタログに登録できる', () => {
    expect(() => createAuditActionCatalog(AUDIT_ACTIONS)).not.toThrow();
  });

  test('本specの4種別だけが載る', () => {
    expect(AUDIT_ACTIONS.map((action) => action.name)).toEqual([
      'admin-account.invite',
      'admin-account.delete',
      'admin-account.role-change',
      'user.email-search',
    ]);
  });

  test.each(
    ADMIN_FOUNDATION_AUDIT_ACTIONS.map((action) => [action.name, action]),
  )('本specの種別%sを名前で引ける', (name, action) => {
    expect(createAuditActionCatalog(AUDIT_ACTIONS).find(name)).toBe(action);
  });

  test('メールアドレス検索の種別は理由と詳細を受け付けない', () => {
    const search =
      createAuditActionCatalog(AUDIT_ACTIONS).find('user.email-search');

    expect(search?.reason).toBe('none');
    expect(search?.detailKeys).toEqual([]);
  });

  test('集約点は凍結されていて実行時に種別を追加できない', () => {
    expect(Object.isFrozen(AUDIT_ACTIONS)).toBe(true);
  });
});
