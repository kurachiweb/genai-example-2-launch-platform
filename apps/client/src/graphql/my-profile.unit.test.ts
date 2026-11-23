import { describe, expect, test } from 'bun:test';
import type { QueryClient } from '@tanstack/react-query';

import { createAppQueryClient } from '../../lib/start/query-client.ts';
import {
  graphqlResponse,
  htmlResponse,
  recordingApi,
  renderContextOf,
  runInStartRequest,
} from '../../lib/test/start-request-fixtures.ts';
import {
  documentIdOf,
  graphqlQueryKey,
} from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientMyProfileDocument,
  type ClientMyProfileQuery,
} from './generated/graphql.ts';
import { loadMyProfile, myProfileQueryOptions } from './my-profile.ts';

const VIEWER_ID = '01JC0VIEWER0000000000000000';

const PROFILE: ClientMyProfileQuery = {
  myProfile: {
    nickname: 'ピッチの作り手',
    handle: 'pitch_maker',
    previousHandle: null,
    headline: null,
    bio: null,
    suspended: false,
    avatar: null,
    websites: [{ name: null, url: 'https://pitch-maker.example' }],
  },
};

// 外部へ通信しないよう、描画の文脈のAPIを偽物にしてサーバーの分岐で取得し、APIへ送った識別子と変数を読み取る
const runThroughApi = async (
  run: (queryClient: QueryClient) => Promise<unknown>,
  respond: () => Promise<Response>,
) => {
  const api = recordingApi(respond);
  const queryClient = createAppQueryClient({ isServer: true });
  let result: unknown;
  await runInStartRequest({
    context: renderContextOf({ api, reported: [] }),
    render: async () => {
      result = await run(queryClient);
      return htmlResponse();
    },
  });
  const sent = await Promise.all(api.requests.map((request) => request.json()));
  return { result, sent, queryClient };
};

describe('myProfileQueryOptions', () => {
  test('前の利用者の取得結果を見せないよう、共通の取得の補助のキーの後に利用者のIDを加える', () => {
    expect([...myProfileQueryOptions(VIEWER_ID).queryKey]).toStrictEqual([
      ...graphqlQueryKey(ClientMyProfileDocument, {}),
      VIEWER_ID,
    ]);
  });
});

describe('loadMyProfile', () => {
  test('保存の時に送るハンドルを実際の値と合わせるため、キャッシュに新しい値があっても取得し直してキャッシュに残す', async () => {
    const { result, sent } = await runThroughApi(
      async (client) => {
        const { queryKey } = myProfileQueryOptions(VIEWER_ID);
        client.setQueryData(queryKey, {
          myProfile: { ...PROFILE.myProfile, handle: 'old_handle' },
        });
        await loadMyProfile({
          context: { queryClient: client, viewer: { id: VIEWER_ID } },
        });
        return client.getQueryData(queryKey);
      },
      () => Promise.resolve(graphqlResponse({ data: PROFILE })),
    );

    expect(sent).toStrictEqual([
      { documentId: documentIdOf(ClientMyProfileDocument), variables: {} },
    ]);
    expect(result).toStrictEqual(PROFILE);
  });

  test('取得に失敗しても、ページの中で再試行できるよう例外にせず失敗をキャッシュに残す', async () => {
    const { result, queryClient } = await runThroughApi(
      (client) =>
        loadMyProfile({
          context: { queryClient: client, viewer: { id: VIEWER_ID } },
        }).then(() => 'loaded'),
      () => Promise.resolve(new Response('', { status: 503 })),
    );

    expect(result).toBe('loaded');
    expect(
      queryClient.getQueryState(myProfileQueryOptions(VIEWER_ID).queryKey)
        ?.status,
    ).toBe('error');
  });
});
