import type { ReactNode } from 'react';

import { MAIN_CONTENT_ID } from '../../../lib/components/app-shell/main-content.ts';
import type { SiteLayoutSlots } from '../../composition/layout-slots.ts';
import { SiteFooter } from './site-footer.tsx';
import { SiteHeader } from './site-header.tsx';
import { slotKeyOf } from './slot-key.ts';

export interface SiteLayoutProps {
  readonly slots: SiteLayoutSlots;
  readonly children: ReactNode;
}

export function SiteLayout({ slots, children }: SiteLayoutProps) {
  const {
    headerAccount,
    headerLaunchAction,
    belowHeader,
    beforeFooter,
    footerHelpLinks,
  } = slots;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader launchAction={headerLaunchAction} account={headerAccount} />
      {belowHeader.map((Slot) => (
        <Slot key={slotKeyOf(Slot)} />
      ))}
      <main id={MAIN_CONTENT_ID} className="flex-1">
        {children}
      </main>
      {beforeFooter.map((Slot) => (
        <Slot key={slotKeyOf(Slot)} />
      ))}
      <SiteFooter helpLinks={footerHelpLinks} />
    </div>
  );
}
