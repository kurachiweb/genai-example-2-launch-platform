import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  adminAccountsQueryOptions,
  loadAdminAccounts,
  toAdminAccount,
  toAdminAccounts,
} from './admin-accounts.ts';
import {
  AdminAccountsDocument,
  type AdminAccountsQuery,
} from './generated/graphql.ts';

type AccountFields = AdminAccountsQuery['adminAccounts'][number];

const AVATAR = {
  id: '01JC0AVATAR00000000000000000',
  objectKey: 'media/01JC0AVATAR00000000000000000',
  fallbackFormat: 'PNG',
  width: 512,
  height: 512,
} as const;

const ACTIVE_ACCOUNT: AccountFields = {
  id: '01JC0ADMIN000000000000000001',
  email: 'moderator@admin.example',
  nickname: '審査の担当',
  title: 'モデレーション担当',
  avatar: AVATAR,
  role: 'MODERATOR',
  status: 'ACTIVE',
  createdAt: '2026-10-01T03:00:00.000Z',
};

const INVITED_ACCOUNT: AccountFields = {
  id: '01JC0ADMIN000000000000000002',
  email: 'invited@admin.example',
  nickname: null,
  title: null,
  avatar: null,
  role: 'VIEWER',
  status: 'INVITED',
  createdAt: '2026-11-01T03:00:00.000Z',
};

describe('toAdminAccount', () => {
  test('一覧の項目を、ロールと状態を画面の値にして取り出す', () => {
    expect(toAdminAccount(ACTIVE_ACCOUNT)).toStrictEqual({
      id: '01JC0ADMIN000000000000000001',
      email: 'moderator@admin.example',
      nickname: '審査の担当',
      title: 'モデレーション担当',
      avatar: { ...AVATAR },
      role: 'moderator',
      status: 'active',
      createdAt: '2026-10-01T03:00:00.000Z',
    });
  });

  test.each([
    ['ACTIVE', 'active'],
    ['INVITED', 'invited'],
    ['INVITATION_EXPIRED', 'invitation_expired'],
  ] as const)('状態%sを%sにする', (status, expected) => {
    expect(toAdminAccount({ ...INVITED_ACCOUNT, status }).status).toBe(
      expected,
    );
  });

  test('招待の完了前の未設定の項目と画像はnullのままにする', () => {
    const account = toAdminAccount(INVITED_ACCOUNT);

    expect(account.nickname).toBeNull();
    expect(account.title).toBeNull();
    expect(account.avatar).toBeNull();
    expect(account.role).toBe('viewer');
  });
});

describe('toAdminAccounts', () => {
  test('APIの返した順のまま全管理者を変換する', () => {
    const accounts = toAdminAccounts({
      adminAccounts: [INVITED_ACCOUNT, ACTIVE_ACCOUNT],
    });

    expect(accounts.map(({ id }) => id)).toStrictEqual([
      INVITED_ACCOUNT.id,
      ACTIVE_ACCOUNT.id,
    ]);
  });
});

describe('adminAccountsQueryOptions', () => {
  test('管理者の一覧の操作と空の変数をキーにする', () => {
    expect([...adminAccountsQueryOptions().queryKey]).toStrictEqual([
      ...graphqlQueryKey(AdminAccountsDocument, {}),
    ]);
  });
});

describe('loadAdminAccounts', () => {
  test('一覧を取得してキャッシュに入れる', async () => {
    const data: AdminAccountsQuery = { adminAccounts: [ACTIVE_ACCOUNT] };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity } },
    });
    queryClient.setQueryData(adminAccountsQueryOptions().queryKey, data);

    await loadAdminAccounts({ context: { queryClient } });

    expect(queryClient.getQueryData(adminAccountsQueryOptions().queryKey)).toBe(
      data,
    );
  });

  test('取得の失敗はそのまま投げ、ページのエラーの画面に任せる', async () => {
    const failure = new Error('取得の失敗');
    const queryClient = {
      query: () => Promise.reject(failure),
    } as unknown as QueryClient;

    const thrown = await loadAdminAccounts({ context: { queryClient } }).catch(
      (error: unknown) => error,
    );

    expect(thrown).toBe(failure);
  });
});
