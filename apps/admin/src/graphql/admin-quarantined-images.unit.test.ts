import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

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
  type AdminQuarantinedImageView,
  adminQuarantinedImagesQueryOptions,
  imageModerationActionOptions,
  invalidateAdminQuarantinedImageQueries,
  loadAdminQuarantinedImagesPage,
  toAdminQuarantinedImages,
} from './admin-quarantined-images.ts';
import {
  AdminApproveQuarantinedImageDocument,
  AdminDeleteQuarantinedImageDocument,
  AdminQuarantinedImagesDocument,
  type AdminQuarantinedImagesQuery,
  AdminQuarantineImageDocument,
  AdminReleaseQuarantinedImageDocument,
} from './generated/graphql.ts';

const FILE_ID = '01JC0FILE00000000000000001';
const USER_ID = '01JC0USER00000000000000001';

type ImageItem =
  AdminQuarantinedImagesQuery['adminQuarantinedImages']['items'][number];

const AUTO_IMAGE: ImageItem = {
  file: {
    id: FILE_ID,
    path: `/media/files/${FILE_ID}`,
    quarantined: true,
    quarantineReasons: ['AUTO', 'ADMIN_ACTION'],
  },
  purpose: 'user_avatar',
  owner: {
    kind: 'user',
    id: USER_ID,
    nickname: 'メーカーAI',
    handle: 'maker_ai',
  },
  quarantinedAt: '2026-11-19T01:00:00.000Z',
  findings: ['暴力的な表現(信頼度91%)'],
};

const AUTO_IMAGE_VIEW: AdminQuarantinedImageView = {
  file: {
    id: FILE_ID,
    path: `/media/files/${FILE_ID}`,
    quarantined: true,
    quarantineReasons: ['auto', 'admin_action'],
  },
  purpose: 'user_avatar',
  owner: {
    kind: 'user',
    id: USER_ID,
    nickname: 'メーカーAI',
    handle: 'maker_ai',
  },
  quarantinedAt: '2026-11-19T01:00:00.000Z',
  findings: ['暴力的な表現(信頼度91%)'],
};

const pageOf = (
  items: readonly ImageItem[],
  nextCursor: string | null,
): AdminQuarantinedImagesQuery => ({
  adminQuarantinedImages: { items: [...items], nextCursor },
});

describe('adminQuarantinedImagesQueryOptions', () => {
  test('隔離理由を大文字の列挙へ写してキーにし、続きのカーソルを次のページの位置にする', () => {
    const options = adminQuarantinedImagesQueryOptions('product_hidden');
    const nextOf = (page: AdminQuarantinedImagesQuery) =>
      options.getNextPageParam(page, [page], null, [null]);

    expect([...options.queryKey]).toStrictEqual([
      ...graphqlQueryKey(AdminQuarantinedImagesDocument, {
        reason: 'PRODUCT_HIDDEN',
      }),
    ]);
    expect(nextOf(pageOf([], 'cursor-2'))).toBe('cursor-2');
    expect(nextOf(pageOf([], null))).toBeUndefined();
  });

  test('4つの隔離理由をそれぞれの大文字の列挙へ写す', () => {
    expect(
      (
        ['auto', 'product_hidden', 'user_suspended', 'admin_action'] as const
      ).map((reason) => adminQuarantinedImagesQueryOptions(reason).queryKey[1]),
    ).toStrictEqual([
      { reason: 'AUTO' },
      { reason: 'PRODUCT_HIDDEN' },
      { reason: 'USER_SUSPENDED' },
      { reason: 'ADMIN_ACTION' },
    ]);
  });

  test('最初のページはカーソルを持たず、続きのページはカーソルを変数にして実行する', async () => {
    const options = adminQuarantinedImagesQueryOptions('auto');
    const { result, sent } = await runThroughApi(
      async (queryClient) => {
        await queryClient.infiniteQuery(options);
        return queryClient.infiniteQuery({ ...options, pages: 2 });
      },
      dataResponse(pageOf([AUTO_IMAGE], 'cursor-2')),
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(AdminQuarantinedImagesDocument),
        variables: { reason: 'AUTO' },
      },
      {
        documentId: documentIdOf(AdminQuarantinedImagesDocument),
        variables: { reason: 'AUTO' },
      },
      {
        documentId: documentIdOf(AdminQuarantinedImagesDocument),
        variables: { reason: 'AUTO', after: 'cursor-2' },
      },
    ]);
    expect(toAdminQuarantinedImages(result)).toStrictEqual([
      AUTO_IMAGE_VIEW,
      AUTO_IMAGE_VIEW,
    ]);
  });
});

describe('toAdminQuarantinedImages', () => {
  test('システムが保有する画像の保有者と、表示名を引けない保有者はnullのまま、検出内容の無い画像は空の一覧にする', () => {
    expect(
      toAdminQuarantinedImages({
        pages: [
          pageOf(
            [
              { ...AUTO_IMAGE, owner: null, findings: [] },
              {
                ...AUTO_IMAGE,
                owner: {
                  kind: 'admin',
                  id: USER_ID,
                  nickname: null,
                  handle: null,
                },
              },
            ],
            null,
          ),
        ],
        pageParams: [null],
      }),
    ).toStrictEqual([
      { ...AUTO_IMAGE_VIEW, owner: null, findings: [] },
      {
        ...AUTO_IMAGE_VIEW,
        owner: { kind: 'admin', id: USER_ID, nickname: null, handle: null },
      },
    ]);
    expect(
      toAdminQuarantinedImages({ pages: [], pageParams: [] }),
    ).toStrictEqual([]);
  });
});

describe('imageModerationActionOptions', () => {
  test.each([
    [
      'image.approve',
      documentIdOf(AdminApproveQuarantinedImageDocument),
      'approveQuarantinedImage',
    ],
    [
      'image.quarantine',
      documentIdOf(AdminQuarantineImageDocument),
      'quarantineImage',
    ],
    [
      'image.release',
      documentIdOf(AdminReleaseQuarantinedImageDocument),
      'releaseQuarantinedImage',
    ],
    [
      'image.delete',
      documentIdOf(AdminDeleteQuarantinedImageDocument),
      'deleteQuarantinedImage',
    ],
  ] as const)(
    '%sは対象のファイルと理由を操作の変数にして実行し、変化の有無を返す',
    async (action, documentId, field) => {
      const options = imageModerationActionOptions(action);
      const { result, sent } = await runThroughApi(
        () =>
          options.mutationFn({
            variables: { targetId: FILE_ID, reason: '' },
          }),
        dataResponse({ [field]: { changed: true } }),
      );

      expect(options.mutationKey).toStrictEqual([documentId]);
      expect(sent).toStrictEqual([
        {
          documentId,
          variables: { fileId: FILE_ID, reason: '' },
        },
      ]);
      expect(result).toStrictEqual({ changed: true });
    },
  );
});

describe('invalidateAdminQuarantinedImageQueries', () => {
  test('隔離理由によらず隔離画像の一覧の取得を全て無効にする', async () => {
    const queryClient = new QueryClient();
    const auto = adminQuarantinedImagesQueryOptions('auto');
    const admin = adminQuarantinedImagesQueryOptions('admin_action');
    queryClient.setQueryData(auto.queryKey, { pages: [], pageParams: [] });
    queryClient.setQueryData(admin.queryKey, { pages: [], pageParams: [] });

    await invalidateAdminQuarantinedImageQueries(queryClient);

    expect(queryClient.getQueryState(auto.queryKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(admin.queryKey)?.isInvalidated).toBe(true);
  });
});

describe('loadAdminQuarantinedImagesPage', () => {
  test('選んだ隔離理由の一覧の最初のページだけを読み、他の理由の一覧は読まない', async () => {
    const { result, sent } = await runThroughApi(
      async (queryClient) => {
        await loadAdminQuarantinedImagesPage({
          context: { queryClient },
          deps: { reason: 'user_suspended' },
        });
        return queryClient.getQueryData(
          adminQuarantinedImagesQueryOptions('user_suspended').queryKey,
        );
      },
      dataResponse(pageOf([AUTO_IMAGE], 'cursor-2')),
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(AdminQuarantinedImagesDocument),
        variables: { reason: 'USER_SUSPENDED' },
      },
    ]);
    expect(result).toStrictEqual({
      pages: [pageOf([AUTO_IMAGE], 'cursor-2')],
      pageParams: [null],
    });
  });

  test('取得に失敗しても、一覧の中で再試行できるよう例外にせず失敗をキャッシュに残す', async () => {
    const { result, queryClient } = await runThroughApi(
      (client) =>
        loadAdminQuarantinedImagesPage({
          context: { queryClient: client },
          deps: { reason: 'auto' },
        }),
      unavailableResponse,
    );

    expect(result).toBeUndefined();
    expect(
      queryClient.getQueryState(
        adminQuarantinedImagesQueryOptions('auto').queryKey,
      )?.status,
    ).toBe('error');
  });
});
