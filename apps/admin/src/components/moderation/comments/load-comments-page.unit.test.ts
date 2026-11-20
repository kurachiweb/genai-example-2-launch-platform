import { describe, expect, test } from 'bun:test';
import { environmentManager, type QueryClient } from '@tanstack/react-query';

import { createAppRuntimeHolder } from '../../../../lib/start/router-context.ts';
import { resolveBrowserDisplayPreferences } from '../../../../lib/utilities/datetime/display-preferences.ts';
import { adminModerationCommentsQueryOptions } from '../../../graphql/admin-moderation-engagement.ts';
import { commentModerationListArgsOf } from '../shared/moderation-search.ts';
import { loadCommentsPage } from './load-comments-page.ts';

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

interface RecordingQueryClient {
  readonly client: QueryClient;
  readonly queried: unknown[];
}

const recordingQueryClient = (
  respond: () => Promise<unknown> = () => Promise.resolve(undefined),
): RecordingQueryClient => {
  const queried: unknown[] = [];
  const client = {
    query: (options: { readonly queryKey: readonly unknown[] }) => {
      queried.push(options.queryKey);
      return respond();
    },
  } as unknown as QueryClient;
  return { client, queried };
};

const SEARCH = Object.freeze({
  authorHandle: 'maker_ai',
  from: '2026-11-01',
  to: '2026-11-03',
  state: 'hidden',
  after: 'cursor-1',
} as const);

describe('loadCommentsPage', () => {
  test('検索パラメータの投稿日の期間を、ルーターの文脈の地域の暦で投稿日時の範囲にして一覧を取得する', async () => {
    const { client, queried } = recordingQueryClient();

    await loadCommentsPage({
      context: { queryClient: client, runtime: runtimeIn('Asia/Tokyo') },
      deps: SEARCH,
      cause: 'enter',
    });

    expect(queried).toStrictEqual([
      adminModerationCommentsQueryOptions({
        authorHandle: 'maker_ai',
        postedFrom: '2026-10-31T15:00:00.000Z',
        postedBefore: '2026-11-03T15:00:00.000Z',
        state: 'hidden',
        after: 'cursor-1',
      }).queryKey,
    ]);
  });

  test('ブラウザでは、一覧の日時の表示と同じくブラウザの地域の暦で期間を決める', async () => {
    const { client, queried } = recordingQueryClient();
    const browserTimeZone = resolveBrowserDisplayPreferences().timeZone;
    environmentManager.setIsServer(() => false);
    try {
      await loadCommentsPage({
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

    expect(queried).toStrictEqual([
      adminModerationCommentsQueryOptions(
        commentModerationListArgsOf({ to: '2026-11-04' }, browserTimeZone),
      ).queryKey,
    ]);
  });

  test('一覧の取得の失敗は投げず、一覧の中で示せるようキャッシュに任せる', async () => {
    const { client } = recordingQueryClient(() =>
      Promise.reject(new Error('取得の失敗')),
    );

    const outcome = await loadCommentsPage({
      context: { queryClient: client, runtime: runtimeIn('UTC') },
      deps: {},
      cause: 'enter',
    }).then(
      () => 'resolved',
      () => 'rejected',
    );

    expect(outcome).toBe('resolved');
  });

  // 取得が終わらないまま、読み込みが次のタスクまでに終わるかを調べる
  const settlesWhileFetching = async (
    cause: 'enter' | 'preload' | 'stay',
  ): Promise<boolean> => {
    const { client, queried } = recordingQueryClient(
      () => new Promise<never>(() => undefined),
    );
    const loading = loadCommentsPage({
      context: { queryClient: client, runtime: runtimeIn('UTC') },
      deps: {},
      cause,
    }).then(() => true);
    const settled = await Promise.race([
      loading,
      new Promise<false>((resolve) => {
        setTimeout(() => {
          resolve(false);
        }, 0);
      }),
    ]);
    expect(queried).toHaveLength(1);
    return settled;
  };

  test.each(['enter', 'preload'] as const)(
    '%sの読み込みは取得の終わりを待つ',
    async (cause) => {
      expect(await settlesWhileFetching(cause)).toBe(false);
    },
  );

  test('同じ画面の中の条件の変更とページの移動(stay)は、取得を始めるだけで待たない', async () => {
    expect(await settlesWhileFetching('stay')).toBe(true);
  });
});
