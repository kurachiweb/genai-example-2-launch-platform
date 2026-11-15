import { createFileRoute } from '@tanstack/react-router';

import { toAuditLogSearch } from '../../../components/audit/audit-log-search.ts';
import { AUDIT_LOGS_TITLE } from '../../../components/audit/audit-logs-messages.ts';
import { loadAuditLogsPage } from '../../../components/audit/load-audit-logs-page.ts';
import { AuditLogsPage } from '../../../components/pages/audit-logs-page.tsx';
import { buildAdminPageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/_authenticated/audit-logs/')({
  validateSearch: toAuditLogSearch,
  loaderDeps: ({ search }) => search,
  loader: loadAuditLogsPage,
  head: () => buildAdminPageHead({ title: AUDIT_LOGS_TITLE }),
  component: AuditLogsPage,
});
