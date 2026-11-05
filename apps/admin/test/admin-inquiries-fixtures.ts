import { createRoute } from '@tanstack/react-router';
import type { Mock } from 'vitest';

import { toAdminInquirySearch } from '../src/components/inquiry/admin-inquiry-search.ts';
import {
  loadAdminInquiriesPage,
  loadAdminInquiryPage,
} from '../src/graphql/admin-inquiries.ts';
import {
  AdminInquiriesDocument,
  type AdminInquiriesQuery,
  type AdminInquiriesQueryVariables,
  AdminInquiryCategoryOptionsDocument,
  type AdminInquiryCategoryOptionsQuery,
  AdminInquiryDocument,
  type AdminInquiryQuery,
  type AdminInquiryQueryVariables,
  type AdminRole,
} from '../src/graphql/generated/graphql.ts';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { Route as InquiryDetailRoute } from '../src/routes/_authenticated/inquiries/$inquiryId.tsx';
import { Route as InquiriesRoute } from '../src/routes/_authenticated/inquiries/index.tsx';
import {
  type GraphQLHandler,
  respondAdminGraphQL,
  success,
} from './admin-accounts-fixtures.ts';
import { adminWithRole } from './admin-viewer-fixtures.ts';
import { type PageRootRoute, renderPageRouter } from './page-router.tsx';

export const INQUIRIES_PATH = '/inquiries';

export const MEMBER_INQUIRY_ID = '01JC0MINQVRY0000000000000A';

export const WITHDRAWN_INQUIRY_ID = '01JC0MINQVRY0000000000000B';

export const GUEST_INQUIRY_ID = '01JC0GVESTNQ0000000000000A';

export const BUG_CATEGORY = Object.freeze({
  id: '01JC0CATEGRY0000000000000A',
  name: '不具合の報告',
});

export const OTHER_CATEGORY = Object.freeze({
  id: '01JC0000000000000000000000',
  name: 'その他',
});

export const CATEGORY_OPTIONS: AdminInquiryCategoryOptionsQuery = {
  adminInquiryCategories: [{ ...BUG_CATEGORY }, { ...OTHER_CATEGORY }],
};

export type AdminInquiryEntry =
  AdminInquiriesQuery['adminInquiries']['entries'][number];

export const MEMBER_ENTRY: AdminInquiryEntry = Object.freeze({
  id: MEMBER_INQUIRY_ID,
  kind: 'MEMBER',
  category: { ...BUG_CATEGORY },
  status: 'IN_PROGRESS',
  senderName: 'サンプル太郎',
  withdrawn: false,
  createdAt: '2026-11-04T01:00:00.000Z',
  lastMessageAt: '2026-11-04T05:30:00.000Z',
});

export const WITHDRAWN_ENTRY: AdminInquiryEntry = Object.freeze({
  id: WITHDRAWN_INQUIRY_ID,
  kind: 'MEMBER',
  category: { ...OTHER_CATEGORY },
  status: 'OPEN',
  senderName: '退会した花子',
  withdrawn: true,
  createdAt: '2026-11-03T02:00:00.000Z',
  lastMessageAt: '2026-11-03T02:00:00.000Z',
});

export const GUEST_ENTRY: AdminInquiryEntry = Object.freeze({
  id: GUEST_INQUIRY_ID,
  kind: 'GUEST',
  category: { ...OTHER_CATEGORY },
  status: 'RESOLVED',
  senderName: '訪問者',
  withdrawn: false,
  createdAt: '2026-11-02T03:00:00.000Z',
  lastMessageAt: '2026-11-02T03:00:00.000Z',
});

export const inquiriesQueryOf = (
  entries: readonly AdminInquiryEntry[],
  nextCursor: string | null = null,
): AdminInquiriesQuery => ({
  adminInquiries: { entries: [...entries], nextCursor },
});

export const FIRST_PAGE = inquiriesQueryOf([
  MEMBER_ENTRY,
  WITHDRAWN_ENTRY,
  GUEST_ENTRY,
]);

export const AVATAR = Object.freeze({
  objectKey: 'fedcba9876543210'.repeat(2),
  fallbackFormat: 'JPG' as const,
  width: 512,
  height: 512,
});

type Detail = NonNullable<AdminInquiryQuery['adminInquiry']>;

export type AdminInquiryMessage = Detail['messages'][number];

export const userMessage = (
  id: string,
  body: string,
  createdAt: string,
  attachments: AdminInquiryMessage['attachments'] = [],
): AdminInquiryMessage => ({
  id,
  sender: 'USER',
  body,
  attachments,
  admin: null,
  createdAt,
});

export const adminReply = (
  id: string,
  body: string,
  createdAt: string,
  admin: AdminInquiryMessage['admin'] = {
    nickname: '運営の担当',
    avatar: { ...AVATAR },
    deleted: false,
  },
): AdminInquiryMessage => ({
  id,
  sender: 'ADMIN',
  body,
  attachments: [],
  admin,
  createdAt,
});

export const memberDetailOf = (overrides: Partial<Detail> = {}): Detail => ({
  id: MEMBER_INQUIRY_ID,
  kind: 'MEMBER',
  category: { ...BUG_CATEGORY },
  status: 'IN_PROGRESS',
  statusChangedAt: '2026-11-04T02:00:00.000Z',
  withdrawn: false,
  createdAt: '2026-11-04T01:00:00.000Z',
  lastMessageAt: '2026-11-04T05:30:00.000Z',
  member: {
    userId: '01JC0VSER000000000000000AA',
    nickname: 'サンプル太郎',
    handle: 'sample_taro',
    avatar: null,
  },
  guest: null,
  messages: [
    userMessage(
      '01JC0MESSAGE00000000000001',
      '画面が表示されません。\n再読み込みしても直りません。',
      '2026-11-04T01:00:00.000Z',
      [
        {
          id: '01JC0F1LE00000000000000001',
          originalFileName: 'screen.png',
          contentType: 'image/png',
          byteSize: 2048,
        },
      ],
    ),
    adminReply(
      '01JC0MESSAGE00000000000002',
      '確認します。',
      '2026-11-04T03:00:00.000Z',
    ),
    adminReply(
      '01JC0MESSAGE00000000000003',
      '修正しました。',
      '2026-11-04T05:30:00.000Z',
      { nickname: null, avatar: null, deleted: true },
    ),
  ],
  ...overrides,
});

export const guestDetailOf = (overrides: Partial<Detail> = {}): Detail => ({
  id: GUEST_INQUIRY_ID,
  kind: 'GUEST',
  category: { ...OTHER_CATEGORY },
  status: 'RESOLVED',
  statusChangedAt: '2026-11-02T04:00:00.000Z',
  withdrawn: false,
  createdAt: '2026-11-02T03:00:00.000Z',
  lastMessageAt: '2026-11-02T03:00:00.000Z',
  member: null,
  guest: {
    nickname: '訪問者',
    email: 'visitor@mail.example',
    body: '退会の方法を教えてください。\nログインできません。',
  },
  messages: [
    userMessage(
      GUEST_INQUIRY_ID,
      '退会の方法を教えてください。\nログインできません。',
      '2026-11-02T03:00:00.000Z',
    ),
  ],
  ...overrides,
});

export type InquiriesHandler = (
  variables: AdminInquiriesQueryVariables,
) => Promise<unknown>;

export type InquiryHandler = (
  variables: AdminInquiryQueryVariables,
) => Promise<unknown>;

const detailById: InquiryHandler = ({ id }) => {
  if (id === MEMBER_INQUIRY_ID) {
    return success({ adminInquiry: memberDetailOf() });
  }
  if (id === GUEST_INQUIRY_ID) {
    return success({ adminInquiry: guestDetailOf() });
  }
  return success({ adminInquiry: null });
};

// 一覧・カテゴリの選択肢・詳細・ログイン中の管理者の取得に応答し、一覧と詳細はテストが渡した応答にする
export function respondAdminInquiriesGraphQL(
  executeGraphQL: Mock,
  {
    role,
    inquiries = () => success(FIRST_PAGE),
    inquiry = detailById,
  }: {
    readonly role: AdminRole;
    readonly inquiries?: InquiriesHandler;
    readonly inquiry?: InquiryHandler;
  },
): void {
  respondAdminGraphQL(executeGraphQL, {
    role,
    handlers: new Map<unknown, GraphQLHandler>([
      [
        AdminInquiriesDocument,
        (variables: unknown) =>
          inquiries(variables as AdminInquiriesQueryVariables),
      ],
      [AdminInquiryCategoryOptionsDocument, () => success(CATEGORY_OPTIONS)],
      [
        AdminInquiryDocument,
        (variables: unknown) =>
          inquiry(variables as AdminInquiryQueryVariables),
      ],
    ]),
  });
}

// アプリの経路の設定を、画面のテスト用のルーターの同じ位置(同じ経路のID)の経路へ写す。経路の設定の検索パラメータの検証・loaderの依存・loaderは型がアプリの経路の木に結び付き写せないため、同じ関数を渡す(同じ関数であることは画面のテストが確かめる)
const createRoutes = (rootRoute: PageRootRoute) => {
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: AuthenticatedRoute.options.beforeLoad,
    component: AuthenticatedRoute.options.component,
  });
  const inquiriesRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: 'inquiries',
  });
  return [
    authenticatedRoute.addChildren([
      inquiriesRoute.addChildren([
        createRoute({
          getParentRoute: () => inquiriesRoute,
          path: '/',
          validateSearch: toAdminInquirySearch,
          loaderDeps: ({ search }) => search,
          loader: loadAdminInquiriesPage,
          component: InquiriesRoute.options.component,
        }),
        createRoute({
          getParentRoute: () => inquiriesRoute,
          path: '$inquiryId',
          loader: loadAdminInquiryPage,
          component: InquiryDetailRoute.options.component,
        }),
      ]),
    ]),
  ];
};

export const renderAdminInquiriesPage = (
  role: AdminRole,
  path = INQUIRIES_PATH,
) =>
  renderPageRouter({
    path,
    createRoutes,
    cachedViewer: adminWithRole(role),
  });

export const inquiriesVariablesOf = (
  executeGraphQL: Mock,
): readonly AdminInquiriesQueryVariables[] =>
  executeGraphQL.mock.calls
    .filter(([document]) => document === AdminInquiriesDocument)
    .map(([, variables]) => variables as AdminInquiriesQueryVariables);

export const inquiryCallsOf = (executeGraphQL: Mock): readonly unknown[] =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === AdminInquiryDocument,
  );
