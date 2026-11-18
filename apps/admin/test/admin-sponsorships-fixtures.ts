import { createRoute } from '@tanstack/react-router';
import type { Mock } from 'vitest';

import { toAdminSponsorshipSearch } from '../src/components/sponsorship/admin-sponsorship-search.ts';
import {
  type AdminSponsorshipRow,
  type AdminSponsorshipTerminationPreview,
  type AdminSponsorshipTerminationResult,
  loadAdminSponsorshipsPage,
} from '../src/graphql/admin-sponsorships.ts';
import {
  AdminSponsorshipsDocument,
  type AdminSponsorshipsQuery,
  type AdminSponsorshipsQueryVariables,
  AdminSponsorshipTerminationPreviewDocument,
  type AdminSponsorshipTerminationPreviewQueryVariables,
  AdminTerminateSponsorshipDocument,
  type AdminTerminateSponsorshipMutationVariables,
  type AdminRole,
} from '../src/graphql/generated/graphql.ts';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { Route as SponsorshipsRoute } from '../src/routes/_authenticated/sponsorships/index.tsx';
import {
  type GraphQLHandler,
  respondAdminGraphQL,
  success,
} from './admin-accounts-fixtures.ts';
import { adminWithRole } from './admin-viewer-fixtures.ts';
import { type PageRootRoute, renderPageRouter } from './page-router.tsx';

export const SPONSORSHIPS_PATH = '/sponsorships';

const usd = (amount: number) => ({ amount, currency: 'USD' });

export const SCHEDULED_ROW: AdminSponsorshipRow = Object.freeze({
  id: '01KA0SPNSR000000000000000A',
  productName: 'サンプルアプリ',
  productHandle: 'sample_app',
  productDeleted: false,
  applicantNickname: 'サンプル太郎',
  tier: 'GOLD',
  startsOn: '2026-12-01',
  endsOn: '2026-12-07',
  days: 7,
  amountPaid: usd(7000),
  status: 'SCHEDULED',
  terminable: true,
  purchaseId: '01KA0PVRCHASE000000000000A',
  createdAt: '2026-11-18T01:00:00.000Z',
});

export const PAUSED_ROW: AdminSponsorshipRow = Object.freeze({
  id: '01KA0SPNSR000000000000000B',
  productName: '停止中のツール',
  productHandle: 'paused_tool',
  productDeleted: false,
  applicantNickname: '停止した次郎',
  tier: 'LEGEND',
  startsOn: '2026-11-10',
  endsOn: '2026-11-30',
  days: 21,
  amountPaid: usd(21000),
  status: 'PAUSED',
  terminable: true,
  purchaseId: '01KA0PVRCHASE000000000000B',
  createdAt: '2026-11-09T02:00:00.000Z',
});

export const DELETED_PRODUCT_ROW: AdminSponsorshipRow = Object.freeze({
  id: '01KA0SPNSR000000000000000C',
  productName: null,
  productHandle: null,
  productDeleted: true,
  applicantNickname: 'サンプル花子',
  tier: 'SILVER',
  startsOn: '2026-11-20',
  endsOn: '2026-11-25',
  days: 6,
  amountPaid: usd(1200),
  status: 'ENDED',
  terminable: false,
  purchaseId: '01KA0PVRCHASE000000000000C',
  createdAt: '2026-11-08T03:00:00.000Z',
});

export const PENDING_ROW: AdminSponsorshipRow = Object.freeze({
  id: '01KA0SPNSR000000000000000D',
  productName: '未決済のサービス',
  productHandle: 'pending_service',
  productDeleted: false,
  applicantNickname: null,
  tier: 'SILVER',
  startsOn: '2027-01-05',
  endsOn: '2027-01-05',
  days: 1,
  amountPaid: null,
  status: 'PENDING_PAYMENT',
  terminable: false,
  purchaseId: null,
  createdAt: '2026-11-07T04:00:00.000Z',
});

export const sponsorshipsQueryOf = (
  nodes: readonly AdminSponsorshipRow[],
  endCursor: string | null = null,
): AdminSponsorshipsQuery => ({
  adminSponsorships: {
    nodes: [...nodes],
    pageInfo: { hasNextPage: endCursor !== null, endCursor },
  },
});

export const FIRST_PAGE = sponsorshipsQueryOf([
  SCHEDULED_ROW,
  PAUSED_ROW,
  DELETED_PRODUCT_ROW,
  PENDING_ROW,
]);

// 表示停止の無い掲載予定の申込の照会。開始日の前の強制終了のため全日が未掲載になる
export const SCHEDULED_PREVIEW: AdminSponsorshipTerminationPreview =
  Object.freeze({
    id: SCHEDULED_ROW.id,
    days: 7,
    amountPaid: usd(7000),
    unexposedDays: 7,
    refundEstimate: usd(7000),
    stoppedDays: 0,
    stopRefundAmount: usd(0),
  });

// 掲載中に表示停止した申込の照会
export const PAUSED_PREVIEW: AdminSponsorshipTerminationPreview = Object.freeze(
  {
    id: PAUSED_ROW.id,
    days: 21,
    amountPaid: usd(21000),
    unexposedDays: 5,
    refundEstimate: usd(5000),
    stoppedDays: 3,
    stopRefundAmount: usd(3000),
  },
);

// 表示停止した申込の確定の結果。既定は両方の返金を依頼した額で依頼した結果
export const terminationResultOf = (
  overrides: Partial<AdminSponsorshipTerminationResult> = {},
): AdminSponsorshipTerminationResult => ({
  id: PAUSED_ROW.id,
  terminatedOn: '2026-11-26',
  days: PAUSED_PREVIEW.days,
  amountPaid: PAUSED_PREVIEW.amountPaid,
  unexposedDays: PAUSED_PREVIEW.unexposedDays,
  refundEstimate: PAUSED_PREVIEW.refundEstimate,
  stoppedDays: PAUSED_PREVIEW.stoppedDays,
  stopRefundAmount: PAUSED_PREVIEW.stopRefundAmount,
  terminationRefundStatus: 'REQUESTED',
  stopRefundStatus: 'REQUESTED',
  terminationRefundRequested: usd(5000),
  stopRefundRequested: usd(3000),
  purchaseId: PAUSED_ROW.purchaseId ?? '',
  ...overrides,
});

export type SponsorshipsHandler = (
  variables: AdminSponsorshipsQueryVariables,
) => Promise<unknown>;

export type TerminationPreviewHandler = (
  variables: AdminSponsorshipTerminationPreviewQueryVariables,
) => Promise<unknown>;

export type TerminateHandler = (
  variables: AdminTerminateSponsorshipMutationVariables,
) => Promise<unknown>;

const PREVIEWS: ReadonlyMap<string, AdminSponsorshipTerminationPreview> =
  new Map([
    [SCHEDULED_PREVIEW.id, SCHEDULED_PREVIEW],
    [PAUSED_PREVIEW.id, PAUSED_PREVIEW],
  ]);

// 一覧の行の申込IDに対応する照会を返す
export const respondPreview: TerminationPreviewHandler = ({ id }) => {
  const preview = PREVIEWS.get(String(id));
  if (preview === undefined) {
    throw new Error(`照会の応答の無い申込IDです: ${String(id)}`);
  }
  return success({ sponsorshipTerminationPreview: preview });
};

const unexpectedTermination: TerminateHandler = () => {
  throw new Error('想定していない強制終了が実行されました。');
};

// 一覧・強制終了の照会と確定・ログイン中の管理者の取得に応答し、一覧と強制終了はテストが渡した応答にする
export function respondAdminSponsorshipsGraphQL(
  executeGraphQL: Mock,
  {
    role,
    sponsorships = () => success(FIRST_PAGE),
    preview = respondPreview,
    terminate = unexpectedTermination,
  }: {
    readonly role: AdminRole;
    readonly sponsorships?: SponsorshipsHandler;
    readonly preview?: TerminationPreviewHandler;
    readonly terminate?: TerminateHandler;
  },
): void {
  respondAdminGraphQL(executeGraphQL, {
    role,
    handlers: new Map<unknown, GraphQLHandler>([
      [
        AdminSponsorshipsDocument,
        (variables: unknown) =>
          sponsorships(variables as AdminSponsorshipsQueryVariables),
      ],
      [
        AdminSponsorshipTerminationPreviewDocument,
        (variables: unknown) =>
          preview(
            variables as AdminSponsorshipTerminationPreviewQueryVariables,
          ),
      ],
      [
        AdminTerminateSponsorshipDocument,
        (variables: unknown) =>
          terminate(variables as AdminTerminateSponsorshipMutationVariables),
      ],
    ]),
  });
}

export const terminateVariablesOf = (
  executeGraphQL: Mock,
): readonly AdminTerminateSponsorshipMutationVariables[] =>
  executeGraphQL.mock.calls
    .filter(([document]) => document === AdminTerminateSponsorshipDocument)
    .map(
      ([, variables]) =>
        variables as AdminTerminateSponsorshipMutationVariables,
    );

// アプリの経路の設定を、画面のテスト用のルーターの同じ位置(同じ経路のID)の経路へ写す。経路の設定の検索パラメータの検証・loaderの依存・loaderは型がアプリの経路の木に結び付き写せないため、同じ関数を渡す(同じ関数であることは画面のテストが確かめる)
const createRoutes = (rootRoute: PageRootRoute) => {
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: AuthenticatedRoute.options.beforeLoad,
    component: AuthenticatedRoute.options.component,
  });
  const sponsorshipsRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: 'sponsorships',
  });
  return [
    authenticatedRoute.addChildren([
      sponsorshipsRoute.addChildren([
        createRoute({
          getParentRoute: () => sponsorshipsRoute,
          path: '/',
          validateSearch: toAdminSponsorshipSearch,
          loaderDeps: ({ search }) => search,
          loader: loadAdminSponsorshipsPage,
          component: SponsorshipsRoute.options.component,
        }),
      ]),
    ]),
  ];
};

export const renderAdminSponsorshipsPage = (
  role: AdminRole,
  path = SPONSORSHIPS_PATH,
) =>
  renderPageRouter({
    path,
    createRoutes,
    cachedViewer: adminWithRole(role),
  });

export const sponsorshipsVariablesOf = (
  executeGraphQL: Mock,
): readonly AdminSponsorshipsQueryVariables[] =>
  executeGraphQL.mock.calls
    .filter(([document]) => document === AdminSponsorshipsDocument)
    .map(([, variables]) => variables as AdminSponsorshipsQueryVariables);
