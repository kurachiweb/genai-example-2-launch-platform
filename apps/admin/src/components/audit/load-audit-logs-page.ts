import { environmentManager } from '@tanstack/react-query';

import {
  appRuntimeOf,
  type RouterContext,
} from '../../../lib/start/router-context.ts';
import { resolveBrowserDisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import { adminAccountsQueryOptions } from '../../graphql/admin-accounts.ts';
import { auditLogsQueryOptions } from '../../graphql/admin-audit-logs.ts';
import {
  type AuditLogSearch,
  auditLogVariablesOf,
} from './audit-log-search.ts';

type AuditLogsPageContext = Pick<RouterContext, 'queryClient' | 'runtime'>;

// 部品は日時の表示と同じ地域の暦(描画中とハイドレーションはサーバーの表示設定、その後はブラウザの地域)で期間を決めるため、先に取得するキーも同じ地域で作る
const periodTimeZoneOf = (context: AuditLogsPageContext): string =>
  environmentManager.isServer()
    ? appRuntimeOf(context).display.timeZone
    : resolveBrowserDisplayPreferences().timeZone;

// 操作者の選択肢が無ければ絞り込めないため、その取得の失敗はルートのエラーの画面に任せる。監査ログの取得の失敗は一覧の中で再試行できるよう、例外にせずキャッシュに残す
export async function loadAuditLogsPage({
  context,
  deps,
}: {
  readonly context: AuditLogsPageContext;
  readonly deps: AuditLogSearch;
}): Promise<void> {
  await Promise.all([
    context.queryClient.query(adminAccountsQueryOptions()),
    context.queryClient
      .query(
        auditLogsQueryOptions(
          auditLogVariablesOf(deps, periodTimeZoneOf(context)),
        ),
      )
      .catch(() => undefined),
  ]);
}
