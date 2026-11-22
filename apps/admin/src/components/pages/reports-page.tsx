import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import { REPORTS_PAGE_COPY } from '../reporting/shared/report-messages.ts';

export function ReportsPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <AdminPageHeader
        title={REPORTS_PAGE_COPY.title}
        description={REPORTS_PAGE_COPY.description}
      />
    </div>
  );
}
