import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import { REPORT_CASE_PAGE_TITLE } from '../reporting/shared/report-messages.ts';

export function ReportCasePage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <AdminPageHeader title={REPORT_CASE_PAGE_TITLE} />
    </div>
  );
}
