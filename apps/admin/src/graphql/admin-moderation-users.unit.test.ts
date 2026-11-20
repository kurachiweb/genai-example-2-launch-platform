import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

import { ADMIN_LIST_PAGE_SIZE } from '../../common-lib/moderation/moderation-actions.ts';
import {
  documentIdOf,
  graphqlQueryKey,
} from '../../lib/utilities/graphql/persisted-document.ts';
import {
  dataResponse,
  runThroughApi,
  unavailableResponse,
} from '../../test/moderation-graphql-api.ts';
import {
  adminModerationUsersQueryOptions,
  invalidateAdminModerationUserQueries,
  loadAdminModerationUsersPage,
  toAdminModerationUserPage,
  userModerationActionOptions,
} from './admin-moderation-users.ts';
import {
  AdminSuspendUserDocument,
  AdminUnsuspendUserDocument,
  AdminUsersDocument,
  type AdminUsersQuery,
  AdminWithdrawUserByAdministratorDocument,
} from './generated/graphql.ts';

const USER_ID = '01JC0USER00000000000000001';
const OTHER_USER_ID = '01JC0USER00000000000000002';
const FILE_ID = '01JC0FILE00000000000000001';

type UserNode = AdminUsersQuery['adminUsers']['nodes'][number];

const SUSPENDED_USER: UserNode = {
  id: USER_ID,
  handle: 'maker_ai',
  nickname: 'メーカーAI',
  avatar: {
    id: FILE_ID,
    path: `/media/files/${FILE_ID}`,
    quarantined: true,
    quarantineReasons: ['USER_SUSPENDED'],
  },
  registeredAt: '2026-10-01T01:00:00.000Z',
  disposableEmail: 'DISPOSABLE',
  status: 'SUSPENDED',
  suspendedAt: '2026-11-19T01:00:00.000Z',
  latestSuspension: {
    reason: 'スパムの投稿',
    occurredAt: '2026-11-19T01:00:00.000Z',
  },
};

const ACTIVE_USER: UserNode = {
  id: OTHER_USER_ID,
  handle: 'scout_ken',
  nickname: 'スカウトKen',
  avatar: null,
  registeredAt: '2026-10-02T01:00:00.000Z',
  disposableEmail: 'UNVERIFIED',
  status: 'ACTIVE',
  suspendedAt: null,
  latestSuspension: null,
};

const usersResponse = (
  nodes: readonly UserNode[],
  endCursor: string | null = null,
): AdminUsersQuery => ({
  adminUsers: {
    nodes: [...nodes],
    pageInfo: { hasNextPage: endCursor !== null, endCursor },
  },
});

describe('adminModerationUsersQueryOptions', () => {
  test('指定した条件だけをGraphQLの絞り込みにし、停止状態を大文字の列挙へ写して1ページ50件で取得する', () => {
    expect([
      ...adminModerationUsersQueryOptions({
        handle: 'maker',
        nickname: 'メーカー',
        email: 'maker@example.example',
        status: 'suspended',
        after: 'cursor-2',
      }).queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(AdminUsersDocument, {
        filter: {
          handle: 'maker',
          nickname: 'メーカー',
          email: 'maker@example.example',
          status: 'SUSPENDED',
        },
        first: ADMIN_LIST_PAGE_SIZE,
        after: 'cursor-2',
      }),
    ]);
  });

  test('条件が無ければ空の絞り込みで1ページ目を取得する', () => {
    expect([...adminModerationUsersQueryOptions({}).queryKey]).toStrictEqual([
      ...graphqlQueryKey(AdminUsersDocument, {
        filter: {},
        first: ADMIN_LIST_PAGE_SIZE,
      }),
    ]);
    expect(
      adminModerationUsersQueryOptions({ status: 'active' }).queryKey[1].filter,
    ).toStrictEqual({ status: 'ACTIVE' });
  });
});

describe('toAdminModerationUserPage', () => {
  test('列挙を共用部品の値へ写し、画像と最新の理由を画面の型にし、続きのカーソルを取り出す', () => {
    expect(
      toAdminModerationUserPage(
        usersResponse([SUSPENDED_USER, ACTIVE_USER], 'cursor-3'),
      ),
    ).toStrictEqual({
      items: [
        {
          id: USER_ID,
          handle: 'maker_ai',
          nickname: 'メーカーAI',
          avatar: {
            id: FILE_ID,
            path: `/media/files/${FILE_ID}`,
            quarantined: true,
            quarantineReasons: ['user_suspended'],
          },
          registeredAt: '2026-10-01T01:00:00.000Z',
          disposableEmail: 'disposable',
          status: 'suspended',
          suspendedAt: '2026-11-19T01:00:00.000Z',
          latestSuspension: {
            reason: 'スパムの投稿',
            occurredAt: '2026-11-19T01:00:00.000Z',
          },
        },
        {
          id: OTHER_USER_ID,
          handle: 'scout_ken',
          nickname: 'スカウトKen',
          avatar: null,
          registeredAt: '2026-10-02T01:00:00.000Z',
          disposableEmail: 'unverified',
          status: 'active',
          suspendedAt: null,
          latestSuspension: null,
        },
      ],
      nextCursor: 'cursor-3',
    });
  });

  test('使い捨ての判定の4値を共用部品の値へ写し、空の一覧は続き無しにする', () => {
    expect(
      (['DISPOSABLE', 'REGULAR', 'UNDETERMINED', 'UNVERIFIED'] as const).map(
        (disposableEmail) =>
          toAdminModerationUserPage(
            usersResponse([{ ...ACTIVE_USER, disposableEmail }]),
          ).items[0]?.disposableEmail,
      ),
    ).toStrictEqual(['disposable', 'regular', 'undetermined', 'unverified']);
    expect(toAdminModerationUserPage(usersResponse([]))).toStrictEqual({
      items: [],
      nextCursor: null,
    });
  });
});

describe('userModerationActionOptions', () => {
  test.each([
    [
      'user.suspend',
      documentIdOf(AdminSuspendUserDocument),
      { suspendUser: { changed: true } },
      { id: USER_ID, reason: '規約違反' },
      true,
    ],
    [
      'user.unsuspend',
      documentIdOf(AdminUnsuspendUserDocument),
      { unsuspendUser: { changed: false } },
      { id: USER_ID, reason: '規約違反' },
      false,
    ],
    [
      'user.administrative-withdraw',
      documentIdOf(AdminWithdrawUserByAdministratorDocument),
      { withdrawUserByAdministrator: { changed: true } },
      { input: { userId: USER_ID, reason: '規約違反' } },
      true,
    ],
  ] as const)(
    '%sは対象と理由を操作の変数にして実行し、変化の有無を返す',
    async (action, documentId, data, variables, changed) => {
      const options = userModerationActionOptions(action);
      const { result, sent } = await runThroughApi(
        () =>
          options.mutationFn({
            variables: { targetId: USER_ID, reason: '規約違反' },
          }),
        dataResponse(data),
      );

      expect(options.mutationKey).toStrictEqual([documentId]);
      expect(sent).toStrictEqual([{ documentId, variables }]);
      expect(result).toStrictEqual({ changed });
    },
  );
});

describe('invalidateAdminModerationUserQueries', () => {
  test('条件によらずユーザーの一覧の取得を全て無効にする', async () => {
    const queryClient = new QueryClient();
    const first = adminModerationUsersQueryOptions({});
    const filtered = adminModerationUsersQueryOptions({ status: 'active' });
    queryClient.setQueryData(first.queryKey, usersResponse([]));
    queryClient.setQueryData(filtered.queryKey, usersResponse([]));

    await invalidateAdminModerationUserQueries(queryClient);

    expect(queryClient.getQueryState(first.queryKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(filtered.queryKey)?.isInvalidated).toBe(
      true,
    );
  });
});

describe('loadAdminModerationUsersPage', () => {
  test('検索の条件の一覧を取得してキャッシュに置く', async () => {
    const deps = { handle: 'maker', after: 'cursor-2' } as const;
    const { result, sent } = await runThroughApi(
      async (queryClient) => {
        await loadAdminModerationUsersPage({
          context: { queryClient },
          deps,
          cause: 'enter',
        });
        return queryClient.getQueryData(
          adminModerationUsersQueryOptions(deps).queryKey,
        );
      },
      dataResponse(usersResponse([ACTIVE_USER])),
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(AdminUsersDocument),
        variables: {
          filter: { handle: 'maker' },
          first: ADMIN_LIST_PAGE_SIZE,
          after: 'cursor-2',
        },
      },
    ]);
    expect(result).toStrictEqual(usersResponse([ACTIVE_USER]));
  });

  test('取得に失敗しても、一覧の中で再試行できるよう例外にせず失敗をキャッシュに残す', async () => {
    const { result, queryClient } = await runThroughApi(
      (client) =>
        loadAdminModerationUsersPage({
          context: { queryClient: client },
          deps: {},
          cause: 'enter',
        }),
      unavailableResponse,
    );

    expect(result).toBeUndefined();
    expect(
      queryClient.getQueryState(adminModerationUsersQueryOptions({}).queryKey)
        ?.status,
    ).toBe('error');
  });

  test.each(['enter', 'preload'] as const)(
    '%sの読み込みは取得の終わりを待つ',
    async (cause) => {
      const { result } = await runThroughApi(
        async (queryClient) => {
          await loadAdminModerationUsersPage({
            context: { queryClient },
            deps: {},
            cause,
          });
          return queryClient.getQueryState(
            adminModerationUsersQueryOptions({}).queryKey,
          )?.fetchStatus;
        },
        dataResponse(usersResponse([ACTIVE_USER])),
      );

      expect(result).toBe('idle');
    },
  );

  test('同じ画面の中の条件の変更とページの移動(stay)は、直前の一覧を残して読み込み中を示せるよう、取得を始めるだけで待たない', async () => {
    const { result } = await runThroughApi(
      async (queryClient) => {
        await loadAdminModerationUsersPage({
          context: { queryClient },
          deps: {},
          cause: 'stay',
        });
        const fetchStatus = queryClient.getQueryState(
          adminModerationUsersQueryOptions({}).queryKey,
        )?.fetchStatus;
        await queryClient.query(adminModerationUsersQueryOptions({}));
        return fetchStatus;
      },
      dataResponse(usersResponse([ACTIVE_USER])),
    );

    expect(result).toBe('fetching');
  });
});
