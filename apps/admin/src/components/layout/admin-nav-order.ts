import type { AdminNavItem } from '../../composition/admin-navigation.ts';

export const orderAdminNavItems = (
  items: readonly AdminNavItem[],
): readonly AdminNavItem[] => items.toSorted((a, b) => a.order - b.order);
