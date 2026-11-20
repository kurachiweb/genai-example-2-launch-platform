import { createRoute } from '@tanstack/react-router';
import type { Mock } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { Toaster } from '../lib/components/feedback/toaster.tsx';
import { quarantinedImageListArgsOf } from '../src/components/moderation/shared/moderation-search.ts';
import { loadAdminQuarantinedImagesPage } from '../src/graphql/admin-quarantined-images.ts';
import {
  AdminQuarantinedImagesDocument,
  type AdminQuarantinedImagesQuery,
  type AdminQuarantinedImagesQueryVariables,
  type AdminRole,
  type QuarantineReason,
} from '../src/graphql/generated/graphql.ts';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { Route as MediaModerationRoute } from '../src/routes/_authenticated/media-moderation/index.tsx';
import { success } from './admin-accounts-fixtures.ts';
import { adminWithRole } from './admin-viewer-fixtures.ts';
import {
  type ModerationGraphQLHandler,
  graphQLImageOf,
  relayPathOf,
  respondModerationGraphQL,
} from './moderation-fixtures.ts';
import { type PageRootRoute, renderPageRouter } from './page-router.tsx';

export const MEDIA_MODERATION_PATH = '/media-moderation';

export type QuarantinedImageNode =
  AdminQuarantinedImagesQuery['adminQuarantinedImages']['items'][number];

const imageNode = ({
  fileId,
  reasons,
  ...rest
}: Omit<QuarantinedImageNode, 'file'> & {
  readonly fileId: string;
  readonly reasons: readonly QuarantineReason[];
}): QuarantinedImageNode =>
  Object.freeze({
    ...rest,
    file: {
      id: fileId,
      path: relayPathOf(fileId),
      image: graphQLImageOf(fileId, null),
      quarantined: true,
      quarantineReasons: [...reasons],
    },
  });

export const AUTO_AVATAR_IMAGE = imageNode({
  fileId: '01KA0MED1A0000000000000021',
  reasons: ['AUTO'],
  purpose: 'user-avatar',
  owner: {
    kind: 'user',
    id: '01KA0VSER00000000000000001',
    nickname: 'サンプル太郎',
    handle: 'maker_ai',
  },
  quarantinedAt: '2026-11-19T01:00:00.000Z',
  findings: [
    '暴力: 武器(信頼度91%)',
    '画像を読み込めないため判定できませんでした',
  ],
});

export const AUTO_AND_ADMIN_LOGO_IMAGE = imageNode({
  fileId: '01KA0MED1A0000000000000022',
  reasons: ['ADMIN_ACTION', 'AUTO'],
  purpose: 'product-logo',
  owner: {
    kind: 'user',
    id: '01KA0VSER00000000000000002',
    nickname: 'サンプル花子',
    handle: 'pixel_hanako',
  },
  quarantinedAt: '2026-11-18T03:30:00.000Z',
  findings: ['SVG: script要素(svg)'],
});

export const ADMIN_AVATAR_IMAGE = imageNode({
  fileId: '01KA0MED1A0000000000000023',
  reasons: ['ADMIN_ACTION'],
  purpose: 'admin-avatar',
  owner: {
    kind: 'admin',
    id: '01KA0ADM1N0000000000000001',
    nickname: '運営サンプル',
    handle: null,
  },
  quarantinedAt: '2026-11-17T00:00:00.000Z',
  findings: [],
});

export const HIDDEN_SCREENSHOT_IMAGE = imageNode({
  fileId: '01KA0MED1A0000000000000024',
  reasons: ['PRODUCT_HIDDEN', 'USER_SUSPENDED'],
  purpose: 'product-screenshot',
  owner: {
    kind: 'user',
    id: '01KA0VSER00000000000000009',
    nickname: null,
    handle: null,
  },
  quarantinedAt: '2026-11-16T00:00:00.000Z',
  findings: [],
});

// 後続の機能が足した表示名の無い用途の、保有者を持たない画像
export const SYSTEM_BANNER_IMAGE = imageNode({
  fileId: '01KA0MED1A0000000000000025',
  reasons: ['USER_SUSPENDED'],
  purpose: 'sponsor-banner',
  owner: null,
  quarantinedAt: '2026-11-15T00:00:00.000Z',
  findings: [],
});

const IMAGES_BY_REASON: Readonly<
  Record<QuarantineReason, readonly QuarantinedImageNode[]>
> = Object.freeze({
  AUTO: [AUTO_AVATAR_IMAGE, AUTO_AND_ADMIN_LOGO_IMAGE],
  ADMIN_ACTION: [AUTO_AND_ADMIN_LOGO_IMAGE, ADMIN_AVATAR_IMAGE],
  PRODUCT_HIDDEN: [HIDDEN_SCREENSHOT_IMAGE],
  USER_SUSPENDED: [HIDDEN_SCREENSHOT_IMAGE, SYSTEM_BANNER_IMAGE],
});

export const quarantinedImagesOf = (
  items: readonly QuarantinedImageNode[],
  nextCursor: string | null = null,
): AdminQuarantinedImagesQuery => ({
  adminQuarantinedImages: { items: [...items], nextCursor },
});

export type ImagesHandler = (
  variables: AdminQuarantinedImagesQueryVariables,
) => Promise<unknown>;

export const imagesByReason: ImagesHandler = ({ reason }) =>
  success(quarantinedImagesOf(IMAGES_BY_REASON[reason]));

// ログイン中の管理者と、隔離画像の一覧・画像の操作にテストが渡した応答を返す
export function respondMediaGraphQL(
  executeGraphQL: Mock,
  {
    role,
    images = imagesByReason,
    handlers = new Map(),
  }: {
    readonly role: AdminRole;
    readonly images?: ImagesHandler;
    readonly handlers?: ReadonlyMap<unknown, ModerationGraphQLHandler>;
  },
): void {
  respondModerationGraphQL(executeGraphQL, {
    role,
    handlers: new Map<unknown, ModerationGraphQLHandler>([
      [
        AdminQuarantinedImagesDocument,
        (variables) =>
          images(variables as AdminQuarantinedImagesQueryVariables),
      ],
      ...handlers,
    ]),
  });
}

// アプリの経路の設定を、画面のテスト用のルーターの同じ位置(同じ経路のID)の経路へ写す。検索パラメータの検証・loaderの依存・loaderは型がアプリの経路の木に結び付き写せないため、同じ関数を渡す(同じ関数であることは画面のテストが確かめる)
const createRoutes = (rootRoute: PageRootRoute) => {
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: AuthenticatedRoute.options.beforeLoad,
    component: AuthenticatedRoute.options.component,
  });
  const mediaModerationRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: 'media-moderation',
  });
  return [
    authenticatedRoute.addChildren([
      mediaModerationRoute.addChildren([
        createRoute({
          getParentRoute: () => mediaModerationRoute,
          path: '/',
          validateSearch: MediaModerationRoute.options.validateSearch,
          loaderDeps: ({ search }) => quarantinedImageListArgsOf(search),
          loader: loadAdminQuarantinedImagesPage,
          component: MediaModerationRoute.options.component,
        }),
      ]),
    ]),
  ];
};

export interface MediaPageRenderOptions {
  readonly role?: AdminRole;
  readonly images?: ImagesHandler;
  readonly handlers?: ReadonlyMap<unknown, ModerationGraphQLHandler>;
  readonly path?: string;
}

// テストのファイルごとに差し替えたGraphQLの実行で画像モデレーションのページを描き、送った一覧の条件を読む
export const mediaPageHarness = (executeGraphQL: Mock) => ({
  renderWith: async ({
    role = 'VIEWER',
    images,
    handlers,
    path = MEDIA_MODERATION_PATH,
  }: MediaPageRenderOptions = {}) => {
    respondMediaGraphQL(executeGraphQL, {
      role,
      ...(images === undefined ? {} : { images }),
      ...(handlers === undefined ? {} : { handlers }),
    });
    // 措置の結果のトーストは文書の外枠が置くため、ページのルーターの外に置く
    await render(<Toaster />);
    return renderPageRouter({
      path,
      createRoutes,
      cachedViewer: adminWithRole(role),
    });
  },
  imagesVariables: (): readonly AdminQuarantinedImagesQueryVariables[] =>
    executeGraphQL.mock.calls
      .filter(([document]) => document === AdminQuarantinedImagesDocument)
      .map(
        ([, variables]) => variables as AdminQuarantinedImagesQueryVariables,
      ),
});

export const main = () => page.getByRole('main');
export const reasonTabs = () =>
  main().getByRole('tablist', { name: '隔離理由' });
export const reasonTab = (name: string) =>
  reasonTabs().getByRole('tab', { name, exact: true });
export const tabPanel = () => main().getByRole('tabpanel');
export const imageList = () =>
  main().getByRole('list', { name: '隔離画像の一覧' });
export const itemOf = (text: string) =>
  imageList().getByRole('listitem').filter({ hasText: text });
export const loadMoreButton = () =>
  main().getByRole('button', { name: 'さらに読み込む' });
export const actionButton = (name: string) =>
  imageList().getByRole('button', { name, exact: true });
export const dialog = () => page.getByRole('dialog');
export const reasonBox = () =>
  dialog().getByRole('textbox', { name: '理由(任意)', exact: true });

// 項目の名前と値を、画面の並びのまま[名前, 値]の組で読む
export const itemDetails = (text: string): readonly (readonly string[])[] =>
  [...itemOf(text).element().querySelectorAll('dt')].map((term) => [
    term.textContent,
    term.nextElementSibling?.textContent ?? '',
  ]);

export const actionNames = () =>
  imageList()
    .getByRole('button')
    .elements()
    .map((button) => button.getAttribute('aria-label'));
