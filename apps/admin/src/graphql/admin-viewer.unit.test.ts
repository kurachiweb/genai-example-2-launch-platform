import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  adminViewerQueryOptions,
  loadRootAuthContext,
  toAdminViewer,
} from './admin-viewer.ts';
import {
  AdminViewerDocument,
  type AdminViewerQuery,
} from './generated/graphql.ts';

const AVATAR = {
  id: '01JC0AVATAR00000000000000000',
  objectKey: 'media/01JC0AVATAR00000000000000000',
  fallbackFormat: 'PNG',
  width: 512,
  height: 512,
} as const;

type SignedInAdmin = NonNullable<AdminViewerQuery['adminViewer']>;

const SIGNED_IN_ADMIN: SignedInAdmin = {
  id: '01JC0ADMIN000000000000000000',
  nickname: '運営の担当',
  title: null,
  email: 'operator@admin.example',
  role: 'SUPER_ADMIN',
  avatar: AVATAR,
  remainingRecoveryCodes: 3,
};

const SIGNED_IN: AdminViewerQuery = { adminViewer: SIGNED_IN_ADMIN };

describe('toAdminViewer', () => {
  test('ログイン中の管理者の項目を、ロールを共有のロールの値にして取り出す', () => {
    expect(toAdminViewer(SIGNED_IN)).toStrictEqual({
      id: '01JC0ADMIN000000000000000000',
      nickname: '運営の担当',
      title: null,
      email: 'operator@admin.example',
      role: 'super_admin',
      avatar: { ...AVATAR },
      remainingRecoveryCodes: 3,
    });
  });

  test('プロフィール画像が無ければnullのままにする', () => {
    const viewer = toAdminViewer({
      adminViewer: { ...SIGNED_IN_ADMIN, avatar: null, role: 'VIEWER' },
    });

    expect(viewer?.avatar).toBeNull();
    expect(viewer?.role).toBe('viewer');
  });

  test('未ログインの応答はnullにする', () => {
    expect(toAdminViewer({ adminViewer: null })).toBeNull();
  });
});

describe('adminViewerQueryOptions', () => {
  test('ログイン中の管理者の操作と空の変数をキーにする', () => {
    expect([...adminViewerQueryOptions().queryKey]).toStrictEqual([
      ...graphqlQueryKey(AdminViewerDocument, {}),
    ]);
  });
});

describe('loadRootAuthContext', () => {
  test('取得したログイン中の管理者を、判定と画面部品に使う形で返す', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity } },
    });
    queryClient.setQueryData(adminViewerQueryOptions().queryKey, SIGNED_IN);

    const auth = await loadRootAuthContext({ context: { queryClient } });

    expect(auth).toStrictEqual({ viewer: toAdminViewer(SIGNED_IN) });
  });

  test('取得に失敗したら未ログインとして扱う', async () => {
    const queryClient = {
      query: () => Promise.reject(new Error('取得の失敗')),
    } as unknown as QueryClient;

    const auth = await loadRootAuthContext({ context: { queryClient } });

    expect(auth).toStrictEqual({ viewer: null });
  });
});
