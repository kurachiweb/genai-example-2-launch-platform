import { redirect } from '@tanstack/react-router';

import { SETTINGS_NAV_ITEMS } from '../../composition/settings-navigation.ts';
import { firstSettingsPath } from './settings-nav-order.ts';

// 設定の入口のbeforeLoad。登録された項目のうちorderが最小の項目へ移す
export function redirectToFirstSettings(): never {
  throw redirect({
    href: firstSettingsPath(SETTINGS_NAV_ITEMS),
    replace: true,
  });
}
