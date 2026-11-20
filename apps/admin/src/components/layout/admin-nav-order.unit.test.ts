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

  test('登録はダッシュボード(10)・ユーザー(20)・プロダクト(30)・コメント(40)・評価(50)・画像モデレーション(60)・問い合わせ(80)・スポンサー広告(90)・ヘルプ記事(100)・カテゴリ(110)・法務文書(120)・設定(130)・管理者アカウント(140)・監査ログ(150)・自分のアカウント(160)', () => {
    expect(orderAdminNavItems(ADMIN_NAV_ITEMS)).toStrictEqual([
      { to: '/', label: 'ダッシュボード', order: 10 },
      { to: '/users', label: 'ユーザー', order: 20 },
      { to: '/products', label: 'プロダクト', order: 30 },
      { to: '/comments', label: 'コメント', order: 40 },
      { to: '/ratings', label: '評価', order: 50 },
      { to: '/media-moderation', label: '画像モデレーション', order: 60 },
      { to: '/inquiries', label: '問い合わせ', order: 80 },
      { to: '/sponsorships', label: 'スポンサー広告', order: 90 },
      { to: '/help-articles', label: 'ヘルプ記事', order: 100 },
      { to: '/categories', label: 'カテゴリ', order: 110 },
      { to: '/legal-documents', label: '法務文書', order: 120 },
      { to: '/settings', label: '設定', order: 130 },
      { to: '/accounts', label: '管理者アカウント', order: 140 },
      { to: '/audit-logs', label: '監査ログ', order: 150 },
      { to: '/account', label: '自分のアカウント', order: 160 },
    ]);
    expect(Object.isFrozen(ADMIN_NAV_ITEMS)).toBe(true);
  });
});
