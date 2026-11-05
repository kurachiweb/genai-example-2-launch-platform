import { describe, expect, test } from 'bun:test';

import {
  ADMIN_NAV_ITEMS,
  type AdminNavItem,
} from '../../composition/admin-navigation.ts';
import { orderAdminNavItems } from './admin-nav-order.ts';

const ITEMS: readonly AdminNavItem[] = Object.freeze([
  { to: '/audit-logs', label: '監査ログ', order: 150 },
  { to: '/', label: 'ダッシュボード', order: 10 },
  { to: '/users', label: 'ユーザー', order: 20 },
]);

describe('メニューの項目の順序', () => {
  test('登録の順によらず、orderの小さい順に並べ、元の一覧を変えない', () => {
    const ordered = orderAdminNavItems(ITEMS);

    expect(ordered.map(({ to }) => to)).toStrictEqual([
      '/',
      '/users',
      '/audit-logs',
    ]);
    expect(ITEMS[0]?.to).toBe('/audit-logs');
  });

  test('登録はダッシュボード(10)・問い合わせ(80)・カテゴリ(110)・法務文書(120)・管理者アカウント(140)・監査ログ(150)・自分のアカウント(160)', () => {
    expect(orderAdminNavItems(ADMIN_NAV_ITEMS)).toStrictEqual([
      { to: '/', label: 'ダッシュボード', order: 10 },
      { to: '/inquiries', label: '問い合わせ', order: 80 },
      { to: '/categories', label: 'カテゴリ', order: 110 },
      { to: '/legal-documents', label: '法務文書', order: 120 },
      { to: '/accounts', label: '管理者アカウント', order: 140 },
      { to: '/audit-logs', label: '監査ログ', order: 150 },
      { to: '/account', label: '自分のアカウント', order: 160 },
    ]);
    expect(Object.isFrozen(ADMIN_NAV_ITEMS)).toBe(true);
  });
});
