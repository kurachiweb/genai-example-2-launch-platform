import type { ReactNode } from 'react';

import type { SettingsNavItem } from '../../composition/settings-navigation.ts';
import { SettingsNavigation } from './settings-navigation.tsx';

export interface SettingsShellProps {
  readonly items: readonly SettingsNavItem[];
  readonly children: ReactNode;
}

export function SettingsShell({ items, children }: SettingsShellProps) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:py-12 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-10">
      <SettingsNavigation items={items} />
      <div className="flex min-w-0 flex-col gap-8">{children}</div>
    </div>
  );
}
