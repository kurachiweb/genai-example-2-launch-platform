import type { ComponentType } from 'react';

import { ThemeToggle } from '../../../lib/components/theme/theme-toggle.tsx';
import { ADMIN_HOME_HREF, ADMIN_SITE_NAME } from './admin-site.ts';

export interface AdminHeaderProps {
  readonly account: ComponentType | null;
}

export function AdminHeader({ account: Account }: AdminHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur supports-backdrop-filter:bg-background/70">
      <div className="flex h-14 w-full items-center gap-3 px-4">
        <a
          href={ADMIN_HOME_HREF}
          className="flex min-w-0 items-center gap-1 text-lg font-extrabold tracking-tight text-foreground no-underline"
        >
          <span aria-hidden="true">⚽️</span>
          {ADMIN_SITE_NAME}
        </a>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <ThemeToggle />
          {Account === null ? null : <Account />}
        </div>
      </div>
    </header>
  );
}
