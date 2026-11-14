import type { SettingsNavItem } from '../../composition/settings-navigation.ts';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { orderSettingsNavItems } from './settings-nav-order.ts';
import { SETTINGS_NAVIGATION_LABEL } from './settings-messages.ts';

export interface SettingsNavigationProps {
  readonly items: readonly SettingsNavItem[];
}

// 項目は他のspecが登録する経路を指し型で指定できないため、パスで遷移させる。現在の項目はリンクがaria-current="page"を付けて示す
export function SettingsNavigation({ items }: SettingsNavigationProps) {
  return (
    <nav aria-label={SETTINGS_NAVIGATION_LABEL}>
      <ul className="flex flex-row flex-wrap gap-1 lg:flex-col">
        {orderSettingsNavItems(items).map((item) => (
          <li key={item.to}>
            <PathLink
              href={item.to}
              className="block rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground aria-[current=page]:bg-accent aria-[current=page]:font-bold aria-[current=page]:text-foreground"
            >
              {item.label}
            </PathLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
