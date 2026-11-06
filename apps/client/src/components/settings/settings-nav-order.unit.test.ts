import { describe, expect, test } from 'bun:test';

import {
  SETTINGS_NAV_ITEMS,
  type SettingsNavItem,
} from '../../composition/settings-navigation.ts';
import {
  firstSettingsPath,
  orderSettingsNavItems,
} from './settings-nav-order.ts';

const ITEMS: readonly SettingsNavItem[] = Object.freeze([
  { to: '/settings/security', label: 'セキュリティ', order: 30 },
  { to: '/settings/profile', label: 'プロフィール', order: 10 },
  { to: '/settings/account', label: 'アカウント', order: 20 },
]);

describe('設定の項目の順序', () => {
  test('登録の順によらず、orderの小さい順に並べ、元の一覧を変えない', () => {
    const ordered = orderSettingsNavItems(ITEMS);

    expect(ordered.map(({ to }) => to)).toStrictEqual([
      '/settings/profile',
      '/settings/account',
      '/settings/security',
    ]);
    expect(ITEMS[0]?.to).toBe('/settings/security');
  });

  test('設定の入口の移動先は、orderが最小の項目にする', () => {
    expect(firstSettingsPath(ITEMS)).toBe('/settings/profile');
  });

  test('項目が無ければ、入口の移動先を決められないことを例外で知らせる', () => {
    expect(() => firstSettingsPath([])).toThrow(TypeError);
  });

  test('登録はアカウント(20)・セキュリティ(30)・決済履歴(70)', () => {
    expect(SETTINGS_NAV_ITEMS).toStrictEqual([
      { to: '/settings/account', label: 'アカウント', order: 20 },
      { to: '/settings/security', label: 'セキュリティ', order: 30 },
      { to: '/settings/billing', label: '決済履歴', order: 70 },
    ]);
  });
});
