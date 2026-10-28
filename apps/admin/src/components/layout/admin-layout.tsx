import type { ReactNode } from 'react';

import { MAIN_CONTENT_ID } from '../../../lib/components/app-shell/main-content.ts';
import type { AdminLayoutSlots } from '../../composition/layout-slots.ts';
import { AdminHeader } from './admin-header.tsx';

export interface AdminLayoutProps {
  readonly slots: AdminLayoutSlots;
  readonly children: ReactNode;
}

export function AdminLayout({ slots, children }: AdminLayoutProps) {
  const { navigation: Navigation, headerAccount } = slots;

  return (
    <div className="flex min-h-screen flex-col">
      <AdminHeader account={headerAccount} />
      <div className="flex flex-1 flex-col md:flex-row">
        {Navigation === null ? null : <Navigation />}
        <main id={MAIN_CONTENT_ID} className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
