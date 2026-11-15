import { describe, expect, test } from 'bun:test';

import { createAuditActionCatalog } from '../audit-action.ts';
import { ADMIN_FOUNDATION_AUDIT_ACTIONS } from './admin-foundation.ts';
import { HELP_CENTER_AUDIT_ACTIONS } from './help-center.ts';
import { AUDIT_ACTIONS } from './index.ts';
import { INQUIRY_AUDIT_ACTIONS } from './inquiry-chat.ts';
import { PRODUCT_LAUNCH_AUDIT_ACTIONS } from './product-launch.ts';
import { ULTRAS_AUDIT_ACTIONS } from './ultras-subscription.ts';

describe('AUDIT_ACTIONS', () => {
  test('集約した全種別を例外なくカタログに登録できる', () => {
    expect(() => createAuditActionCatalog(AUDIT_ACTIONS)).not.toThrow();
  });

  test('admin-foundationの4種別・inquiry-chatの5種別・ultras-subscriptionの1種別・product-launchの3種別・help-centerの8種別だけが載る', () => {
    expect(AUDIT_ACTIONS.map((action) => action.name)).toEqual([
      'admin-account.invite',
      'admin-account.delete',
      'admin-account.role-change',
      'user.email-search',
      'inquiry.reply',
      'inquiry.status-change',
      'inquiry-category.create',
      'inquiry-category.rename',
      'inquiry-category.delete',
      'ultras-promotion.update',
      'product-category.create',
      'product-category.update',
      'product-category.delete',
      'help-article.create',
      'help-article.update',
      'help-article.delete',
      'help-article.reorder',
      'help-category.create',
      'help-category.rename',
      'help-category.delete',
      'help-category.reorder',
    ]);
  });

  test.each(
    [
      ...ADMIN_FOUNDATION_AUDIT_ACTIONS,
      ...INQUIRY_AUDIT_ACTIONS,
      ...ULTRAS_AUDIT_ACTIONS,
      ...PRODUCT_LAUNCH_AUDIT_ACTIONS,
      ...HELP_CENTER_AUDIT_ACTIONS,
    ].map((action) => [action.name, action]),
  )('登録した種別%sを名前で引ける', (name, action) => {
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
