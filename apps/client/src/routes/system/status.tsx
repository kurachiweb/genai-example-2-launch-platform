import { createFileRoute, notFound } from '@tanstack/react-router';

import { executeGraphQL } from '../../../lib/start/graphql/execute-graphql.ts';
import { SYSTEM_STATUS_TITLE } from '../../../lib/utilities/messages/system-status-messages.ts';
import { currentExecutionSite } from '../../../lib/utilities/system/execution-site.ts';
import { isSystemStatusAvailable } from '../../../lib/utilities/system/system-status-availability.ts';
import type { SystemStatusResult } from '../../../lib/utilities/system/system-status-result.ts';
import { SystemStatusPage } from '../../components/pages/system-status-page.tsx';
import { ClientSystemStatusDocument } from '../../graphql/generated/graphql.ts';
import {
  fromSystemStatusLoaderData,
  toSystemStatusLoaderData,
  toSystemStatusResult,
} from '../../graphql/system-status.ts';
import { buildSitePageHead } from '../../head/page-heads.ts';

const fetchSystemStatus = async (): Promise<SystemStatusResult> =>
  toSystemStatusResult(await executeGraphQL(ClientSystemStatusDocument, {}));

export const Route = createFileRoute('/system/status')({
  beforeLoad: ({ context }) => {
    if (
      !isSystemStatusAvailable(context.runtime.get().publicConfig.environment)
    ) {
      throw notFound();
    }
  },
  // APIへ到達できない結果も画面に表示するため、取得の失敗を例外にせず結果として返す。このloaderはページを直接開いた時はサーバーで、画面内の遷移・再試行・先読みではブラウザで実行されるため、実行した場所を結果と組にする
  loader: async () =>
    toSystemStatusLoaderData(await fetchSystemStatus(), currentExecutionSite()),
  head: () => buildSitePageHead({ title: SYSTEM_STATUS_TITLE, noIndex: true }),
  component: SystemStatusRoute,
});

function SystemStatusRoute() {
  const { executedOn, result } = fromSystemStatusLoaderData(
    Route.useLoaderData(),
  );
  return (
    <SystemStatusPage
      initial={result}
      initialExecutedOn={executedOn}
      recheck={fetchSystemStatus}
    />
  );
}
