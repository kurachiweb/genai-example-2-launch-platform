import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientViewerDocument,
  type ClientViewerQuery,
} from './generated/graphql.ts';
import {
  loadRootAuthContext,
  toClientViewer,
  viewerQueryOptions,
} from './viewer.ts';

const SIGNED_IN: ClientViewerQuery = {
  viewer: {
    id: '01JC0VIEWER0000000000000000',
    handle: 'pitch_maker',
    nickname: 'ピッチの作り手',
    emailVerified: false,
    status: 'SUSPENDED',
    totpEnabled: true,
  },
};

describe('toClientViewer', () => {
  test('ログイン中の利用者の項目を、ヘッダーと判定に使う形で取り出す', () => {
    expect(toClientViewer(SIGNED_IN)).toStrictEqual({
      id: '01JC0VIEWER0000000000000000',
      handle: 'pitch_maker',
      nickname: 'ピッチの作り手',
      emailVerified: false,
      status: 'SUSPENDED',
      totpEnabled: true,
    });
  });

  test('未ログインの応答はnullにする', () => {
    expect(toClientViewer({ viewer: null })).toBeNull();
  });
});

describe('viewerQueryOptions', () => {
  test('ログイン中の利用者の操作と空の変数をキーにする', () => {
    expect([...viewerQueryOptions().queryKey]).toStrictEqual([
      ...graphqlQueryKey(ClientViewerDocument, {}),
    ]);
  });
});

describe('loadRootAuthContext', () => {
  test('取得したログイン中の利用者を、ヘッダーと判定に使う形で返す', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity } },
    });
    queryClient.setQueryData(viewerQueryOptions().queryKey, SIGNED_IN);

    const auth = await loadRootAuthContext({ context: { queryClient } });

    expect(auth).toStrictEqual({ viewer: toClientViewer(SIGNED_IN) });
  });

  test('取得に失敗したら未ログインとして扱う', async () => {
    const queryClient = {
      query: () => Promise.reject(new Error('取得の失敗')),
    } as unknown as QueryClient;

    const auth = await loadRootAuthContext({ context: { queryClient } });

    expect(auth).toStrictEqual({ viewer: null });
  });
});
