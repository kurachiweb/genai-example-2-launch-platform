import { environmentManager } from '@tanstack/react-query';

import {
  appRuntimeOf,
  type RouterContext,
} from '../../../../lib/start/router-context.ts';
import { resolveBrowserDisplayPreferences } from '../../../../lib/utilities/datetime/display-preferences.ts';
import { loadReportCasesPage } from '../../../graphql/admin-reporting-cases.ts';
import { type ReportSearch, reportCaseListArgsOf } from './report-search.ts';

type ReportsPageContext = Pick<RouterContext, 'queryClient' | 'runtime'>;

// 部品は日時の表示と同じ地域の暦(描画中とハイドレーションはサーバーの表示設定、その後はブラウザの地域)で受付日の期間を決めるため、先に取得するキーも同じ地域で作る
const periodTimeZoneOf = (context: ReportsPageContext): string =>
  environmentManager.isServer()
    ? appRuntimeOf(context).display.timeZone
    : resolveBrowserDisplayPreferences().timeZone;

export async function loadReportsPage({
  context,
  deps,
  cause,
}: {
  readonly context: ReportsPageContext;
  readonly deps: ReportSearch;
  readonly cause: 'preload' | 'enter' | 'stay';
}): Promise<void> {
  await loadReportCasesPage({
    context,
    deps: reportCaseListArgsOf(deps, periodTimeZoneOf(context)),
    cause,
  });
}
