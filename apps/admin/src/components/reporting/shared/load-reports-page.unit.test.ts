import { describe, expect, test } from 'bun:test';
import { environmentManager, type QueryClient } from '@tanstack/react-query';

import { createAppRuntimeHolder } from '../../../../lib/start/router-context.ts';
import { resolveBrowserDisplayPreferences } from '../../../../lib/utilities/datetime/display-preferences.ts';
import { adminReportCasesQueryOptions } from '../../../graphql/admin-reporting-cases.ts';
import { adminReportCategoriesQueryOptions } from '../../../graphql/admin-reporting-categories.ts';
import { loadReportsPage } from './load-reports-page.ts';
import { reportCaseListArgsOf } from './report-search.ts';

const runtimeIn = (timeZone: string) =>
  createAppRuntimeHolder({
    publicConfig: {
      environment: 'local',
      turnstileSiteKey: '1x00000000000000000000BB',
      clientSiteOrigin: 'https://client.example',
      imagesOrigin: 'https://images.example',
      sentry: { dsn: undefined, environment: 'local', tracesSampleRate: 0 },
      webAnalyticsToken: undefined,
      stripePublishableKey: undefined,
      publicApiOrigin: undefined,
    },
    display: { timeZone, locale: 'ja-JP' },
  });

const recordingQueryClient = () => {
  const queried: unknown[] = [];
  const client = {
    query: (options: { readonly queryKey: readonly unknown[] }) => {
      queried.push(options.queryKey);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryClient;
  return { client, queried };
};

describe('loadReportsPage', () => {
  test('検索パラメータの受付日の期間を、ルーターの文脈の地域の暦で受付日時の範囲にして一覧と絞り込みのカテゴリを取得する', async () => {
    const { client, queried } = recordingQueryClient();

    await loadReportsPage({
      context: { queryClient: client, runtime: runtimeIn('Asia/Tokyo') },
      deps: { status: 'OPEN', from: '2026-11-01', after: 'cursor-1' },
      cause: 'enter',
    });

    expect(queried).toStrictEqual([
      adminReportCasesQueryOptions({
        status: 'open',
        reportedFrom: '2026-10-31T15:00:00.000Z',
        after: 'cursor-1',
      }).queryKey,
      adminReportCategoriesQueryOptions().queryKey,
    ]);
  });

  test('ブラウザでは、一覧の日時の表示と同じくブラウザの地域の暦で期間を決める', async () => {
    const { client, queried } = recordingQueryClient();
    const browserTimeZone = resolveBrowserDisplayPreferences().timeZone;
    environmentManager.setIsServer(() => false);
    try {
      await loadReportsPage({
        context: {
          queryClient: client,
          runtime: runtimeIn('Pacific/Kiritimati'),
        },
        deps: { to: '2026-11-04' },
        cause: 'enter',
      });
    } finally {
      environmentManager.setIsServer(() => true);
    }

    expect(queried[0]).toStrictEqual(
      adminReportCasesQueryOptions(
        reportCaseListArgsOf({ to: '2026-11-04' }, browserTimeZone),
      ).queryKey,
    );
  });
});
