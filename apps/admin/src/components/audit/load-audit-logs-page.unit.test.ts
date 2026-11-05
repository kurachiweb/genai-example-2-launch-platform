import { describe, expect, test } from 'bun:test';
import { environmentManager, type QueryClient } from '@tanstack/react-query';

import { createAppRuntimeHolder } from '../../../lib/start/router-context.ts';
import { resolveBrowserDisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import { adminAccountsQueryOptions } from '../../graphql/admin-accounts.ts';
import { auditLogsQueryOptions } from '../../graphql/admin-audit-logs.ts';
import { toAuditPeriod } from './audit-period.ts';
import { loadAuditLogsPage } from './load-audit-logs-page.ts';

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
    },
    display: { timeZone, locale: 'ja-JP' },
  });

interface RecordingQueryClient {
  readonly client: QueryClient;
  readonly queried: unknown[];
}

// 監査ログの検索のキーの取得は`auditLogs`、それ以外(操作者の選択肢)は`accounts`の結果にする
const recordingQueryClient = ({
  accounts = () => Promise.resolve(undefined),
  auditLogs = () => Promise.resolve(undefined),
}: {
  readonly accounts?: () => Promise<unknown>;
  readonly auditLogs?: () => Promise<unknown>;
} = {}): RecordingQueryClient => {
  const queried: unknown[] = [];
  const auditLogsId = auditLogsQueryOptions({}).queryKey[0];
  const client = {
    query: (options: { readonly queryKey: readonly unknown[] }) => {
      queried.push(options.queryKey);
      return options.queryKey[0] === auditLogsId ? auditLogs() : accounts();
    },
  } as unknown as QueryClient;
  return { client, queried };
};

describe('loadAuditLogsPage', () => {
  test('操作者の選択肢の一覧と、検索パラメータの条件の監査ログを、ルーターの文脈の地域の暦で同時に取得する', async () => {
    const { client, queried } = recordingQueryClient();

    await loadAuditLogsPage({
      context: { queryClient: client, runtime: runtimeIn('Asia/Tokyo') },
      deps: { from: '2026-11-01', after: 'cursor-1' },
    });

    expect(queried).toStrictEqual([
      adminAccountsQueryOptions().queryKey,
      auditLogsQueryOptions({
        filter: { occurredFrom: '2026-10-31T15:00:00.000Z' },
        after: 'cursor-1',
      }).queryKey,
    ]);
  });

  test('ブラウザでは、一覧の日時の表示と同じくブラウザの地域の暦で期間を決める', async () => {
    const { client, queried } = recordingQueryClient();
    const browserTimeZone = resolveBrowserDisplayPreferences().timeZone;
    environmentManager.setIsServer(() => false);
    try {
      await loadAuditLogsPage({
        context: {
          queryClient: client,
          runtime: runtimeIn('Pacific/Kiritimati'),
        },
        deps: { to: '2026-11-04' },
      });
    } finally {
      environmentManager.setIsServer(() => true);
    }

    expect(queried.at(-1)).toStrictEqual(
      auditLogsQueryOptions({
        filter: toAuditPeriod({ to: '2026-11-04' }, browserTimeZone),
      }).queryKey,
    );
  });

  test('監査ログの取得の失敗は投げず、一覧の中で示せるようキャッシュに任せる', async () => {
    const { client } = recordingQueryClient({
      auditLogs: () => Promise.reject(new Error('検索の失敗')),
    });

    const outcome = await loadAuditLogsPage({
      context: { queryClient: client, runtime: runtimeIn('UTC') },
      deps: {},
    }).then(
      () => 'resolved',
      () => 'rejected',
    );

    expect(outcome).toBe('resolved');
  });

  test('操作者の選択肢の取得の失敗はそのまま投げ、ページのエラーの画面に任せる', async () => {
    const failure = new Error('取得の失敗');
    const { client } = recordingQueryClient({
      accounts: () => Promise.reject(failure),
    });

    const thrown = await loadAuditLogsPage({
      context: { queryClient: client, runtime: runtimeIn('UTC') },
      deps: {},
    }).catch((error: unknown) => error);

    expect(thrown).toBe(failure);
  });
});
