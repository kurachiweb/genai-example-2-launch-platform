import type { SettingsNavItem } from '../../composition/settings-navigation.ts';

export const orderSettingsNavItems = (
  items: readonly SettingsNavItem[],
): readonly SettingsNavItem[] => items.toSorted((a, b) => a.order - b.order);

export const firstSettingsPath = (
  items: readonly SettingsNavItem[],
): string => {
  const [first] = orderSettingsNavItems(items);
  if (first === undefined) {
    throw new TypeError('設定の項目が1つも登録されていません。');
  }
  return first.to;
};
