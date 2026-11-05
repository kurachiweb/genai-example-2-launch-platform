import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useState } from 'react';

import { AUDIT_ACTIONS } from '../../../common-lib/admin/audit-actions/index.ts';
import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import { useDisplayPreferences } from '../../../lib/components/datetime/use-display-preferences.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import {
  adminAccountsQueryOptions,
  toAdminAccounts,
} from '../../graphql/admin-accounts.ts';
import {
  auditLogsQueryOptions,
  toAuditLogPage,
} from '../../graphql/admin-audit-logs.ts';
import {
  actionOptionsOf,
  operatorOptionsOf,
} from '../audit/audit-log-filter-options.ts';
import { AuditLogFilters } from '../audit/audit-log-filters.tsx';
import { AuditLogList } from '../audit/audit-log-list.tsx';
import {
  type AuditLogSearch,
  auditLogFilterScopeOf,
  auditLogSearchAt,
  auditLogVariablesOf,
} from '../audit/audit-log-search.ts';
import {
  AUDIT_LOGS_DESCRIPTION,
  AUDIT_LOGS_TITLE,
} from '../audit/audit-logs-messages.ts';
import {
  EMPTY_CURSOR_TRAIL,
  previousPageOf,
  trailAfterNext,
} from '../../../lib/utilities/pagination/cursor-trail.ts';

const routeApi = getRouteApi('/_authenticated/audit-logs/');

export function AuditLogsPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  // 期間の境界は一覧の日時の表示と同じ地域の暦で決める
  const { timeZone } = useDisplayPreferences();
  const { data: accounts } = useSuspenseQuery({
    ...adminAccountsQueryOptions(),
    select: toAdminAccounts,
  });
  const auditLogs = useQuery({
    ...auditLogsQueryOptions(auditLogVariablesOf(search, timeZone)),
    select: toAuditLogPage,
  });
  const [trail, setTrail] = useState(EMPTY_CURSOR_TRAIL);
  const scope = auditLogFilterScopeOf(search);
  const previous = previousPageOf(trail, scope, search.after);
  const nextCursor = auditLogs.data?.nextCursor ?? null;
  // 取得し直している間は前の失敗を示さず読み込み中にする。描画中の取得のうちHTMLを送り始めた時点で終わっていなかったものの失敗は固定の文言の例外としてブラウザへ渡り、表示の後に取得し直した結果で文言を選び直すためでもある
  const failure = auditLogs.isFetching ? null : auditLogs.error;
  const show = (next: AuditLogSearch) => {
    void navigate({ search: next });
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <AdminPageHeader
        title={AUDIT_LOGS_TITLE}
        description={AUDIT_LOGS_DESCRIPTION}
      />
      <AuditLogFilters
        search={search}
        operators={operatorOptionsOf(accounts, search.operator)}
        actions={actionOptionsOf(AUDIT_ACTIONS, search.action)}
        onApply={show}
        onReset={() => {
          show({});
        }}
      />
      <AuditLogList
        entries={auditLogs.data?.entries}
        {...(failure === null
          ? {}
          : {
              error: {
                message: errorMessageOf(
                  failure,
                  ADMIN_PROFILE.contactAvailable,
                ),
                onRetry: () => {
                  void auditLogs.refetch();
                },
              },
            })}
        pagination={{
          hasPrevious: previous.exists,
          hasNext: nextCursor !== null,
          onPrevious: () => {
            show(auditLogSearchAt(search, previous.after));
          },
          onNext: () => {
            if (nextCursor === null) {
              return;
            }
            setTrail(trailAfterNext(trail, scope, search.after, nextCursor));
            show(auditLogSearchAt(search, nextCursor));
          },
        }}
      />
    </div>
  );
}
