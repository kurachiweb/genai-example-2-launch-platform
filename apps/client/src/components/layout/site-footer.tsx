import type { ComponentType } from 'react';

import {
  FOOTER_HELP_NAVIGATION_LABEL,
  FOOTER_HELP_TOP_LINK,
  FOOTER_POLICY_LINKS,
  FOOTER_POLICY_NAVIGATION_LABEL,
  SITE_NAME,
  SITE_TAGLINE,
} from './site-links.ts';
import { slotKeyOf } from './slot-key.ts';

export interface SiteFooterProps {
  readonly helpLinks: readonly ComponentType[];
}

const LINK_CLASS_NAME = 'text-muted-foreground hover:text-foreground';

// 区画の部品が描画するリンクにも同じ見た目を当てるため、色はリンクではなく一覧から指定する
const LINK_LIST_CLASS_NAME =
  'mt-2 space-y-1.5 [&_a]:text-muted-foreground [&_a:hover]:text-foreground';

export function SiteFooter({ helpLinks }: SiteFooterProps) {
  return (
    <footer className="mt-16 border-t border-border bg-card/60">
      <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-10 text-sm sm:grid-cols-3">
        <div>
          <p className="text-base font-extrabold tracking-tight">{SITE_NAME}</p>
          <p className="mt-2 max-w-xs text-muted-foreground">{SITE_TAGLINE}</p>
        </div>
        <nav aria-label={FOOTER_HELP_NAVIGATION_LABEL}>
          <p className="font-semibold">{FOOTER_HELP_NAVIGATION_LABEL}</p>
          <ul className={LINK_LIST_CLASS_NAME}>
            <li>
              <a href={FOOTER_HELP_TOP_LINK.href} className={LINK_CLASS_NAME}>
                {FOOTER_HELP_TOP_LINK.label}
              </a>
            </li>
            {helpLinks.map((HelpLink) => (
              <HelpLink key={slotKeyOf(HelpLink)} />
            ))}
          </ul>
        </nav>
        <nav aria-label={FOOTER_POLICY_NAVIGATION_LABEL}>
          <p className="font-semibold">{FOOTER_POLICY_NAVIGATION_LABEL}</p>
          <ul className={LINK_LIST_CLASS_NAME}>
            {FOOTER_POLICY_LINKS.map(({ href, label }) => (
              <li key={href}>
                <a href={href} className={LINK_CLASS_NAME}>
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
