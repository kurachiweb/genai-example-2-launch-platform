import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import { DASHBOARD_CARDS } from '../../composition/dashboard-cards.ts';
import { DashboardGrid } from '../dashboard/dashboard-grid.tsx';
import { DASHBOARD_TITLE } from '../dashboard/dashboard-messages.ts';

export function DashboardPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <AdminPageHeader title={DASHBOARD_TITLE} />
      <DashboardGrid cards={DASHBOARD_CARDS} />
    </div>
  );
}
