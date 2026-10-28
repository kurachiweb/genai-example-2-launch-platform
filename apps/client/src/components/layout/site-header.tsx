import type { ComponentType } from 'react';

import { ThemeToggle } from '../../../lib/components/theme/theme-toggle.tsx';
import {
  HOME_HREF,
  MAIN_NAVIGATION_LABEL,
  PRIMARY_NAVIGATION_LINKS,
  SITE_NAME,
} from './site-links.ts';
import { SiteMobileMenu } from './site-mobile-menu.tsx';

export interface SiteHeaderProps {
  readonly launchAction: ComponentType;
  readonly account: ComponentType;
}

export function SiteHeader({
  launchAction: LaunchAction,
  account: Account,
}: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur supports-backdrop-filter:bg-background/70">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4">
        <a
          href={HOME_HREF}
          className="flex shrink-0 items-center gap-1 text-lg font-extrabold tracking-tight text-foreground no-underline"
        >
          <span aria-hidden="true">⚽️</span>
          {SITE_NAME}
        </a>
        <nav
          aria-label={MAIN_NAVIGATION_LABEL}
          className="ml-4 hidden items-center gap-1 md:flex"
        >
          {PRIMARY_NAVIGATION_LINKS.map(({ href, label }) => (
            <a
              key={href}
              href={href}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground no-underline hover:bg-accent hover:text-foreground"
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <div className="hidden items-center gap-2 md:flex">
            <LaunchAction />
            <Account />
          </div>
          <SiteMobileMenu launchAction={LaunchAction} account={Account} />
        </div>
      </div>
    </header>
  );
}
