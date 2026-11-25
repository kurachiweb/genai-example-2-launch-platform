import type { QueryClient } from '@tanstack/react-query';
import type { Mock } from 'vitest';

import {
  adminReportCaseQueryOptions,
  adminReportCasesQueryOptions,
  type ReportCaseView,
  type ReportTargetView,
} from '../src/graphql/admin-reporting-cases.ts';
import {
  adminProductReportSummaryQueryOptions,
  adminUnhandledReportSummaryQueryOptions,
} from '../src/graphql/admin-reporting-summaries.ts';
import { adminModerationProductsQueryOptions } from '../src/graphql/admin-moderation-products.ts';
import { adminModerationUsersQueryOptions } from '../src/graphql/admin-moderation-users.ts';
import {
  type AdminReportCasesQuery,
  type AdminReportCaseSummaryFragment,
  type AdminRole,
  AdminViewerDocument,
  type ReportCaseStatus,
} from '../src/graphql/generated/graphql.ts';
import { success } from './admin-accounts-fixtures.ts';
import { adminViewerResult, adminWithRole } from './admin-viewer-fixtures.ts';

export const REPORT_CASE_ID = '01KA0REP0RTCASE00000000001';

export const REPORT_USER_ID = '01KA0VSER00000000000000001';

export const REPORT_PRODUCT_ID = '01KA0PR0DVCT00000000000001';

export const REPORT_COMMENT_ID = '01KA0C0MMENT00000000000001';

export const REPORT_REASON =
  '権利者からの申出を確認し、利用規約に反すると判断したため';

const EMPTY_TARGET: ReportTargetView = Object.freeze({
  kind: 'product',
  id: null,
  detached: false,
  available: true,
  handle: null,
  label: null,
  excerpt: null,
  productId: null,
  productName: null,
  productHandle: null,
});

export const PRODUCT_REPORT_TARGET: ReportTargetView = Object.freeze({
  ...EMPTY_TARGET,
  id: REPORT_PRODUCT_ID,
  handle: 'pitch-notes',
  label: 'Pitch Notes',
});

export const USER_REPORT_TARGET: ReportTargetView = Object.freeze({
  ...EMPTY_TARGET,
  kind: 'user',
  id: REPORT_USER_ID,
  handle: 'maker_ai',
  label: 'サンプル太郎',
});

export const COMMENT_REPORT_TARGET: ReportTargetView = Object.freeze({
  ...EMPTY_TARGET,
  kind: 'comment',
  id: REPORT_COMMENT_ID,
  excerpt: '**強調**のつもりの<b>文字列</b>\n2行目',
  productId: REPORT_PRODUCT_ID,
  productName: 'Pitch Notes',
  productHandle: 'pitch-notes',
});

export const UNAVAILABLE_REPORT_TARGET: ReportTargetView = Object.freeze({
  ...EMPTY_TARGET,
  id: REPORT_PRODUCT_ID,
  available: false,
});

export const DETACHED_REPORT_TARGET: ReportTargetView = Object.freeze({
  ...EMPTY_TARGET,
  kind: 'comment',
  detached: true,
  available: false,
});

export const reportCaseViewOf = (
  patch: Partial<ReportCaseView> = {},
): ReportCaseView => ({
  id: REPORT_CASE_ID,
  target: PRODUCT_REPORT_TARGET,
  status: 'open',
  reportCount: 3,
  categoryCounts: [
    { categoryId: '01JE0000000000000000000001', name: '権利侵害', count: 2 },
    { categoryId: '01JE0000000000000000000002', name: 'その他', count: 1 },
  ],
  firstReportedAt: '2026-11-01T00:00:00.000Z',
  lastReportedAt: '2026-11-02T03:00:00.000Z',
  infringement: true,
  responseTime: {
    startedAt: '2026-11-01T00:00:00.000Z',
    completedAt: null,
    elapsedSeconds: 4 * 60 * 60,
    alerts: [],
  },
  ...patch,
});

export const reportCaseOutcomeOf = (
  field: string,
  status: ReportCaseStatus,
): Promise<unknown> => success({ [field]: { status } });

export type ReportingGraphQLHandler = (variables: unknown) => Promise<unknown>;

// ログイン中の管理者に既定の応答を返し、案件の操作はテストが渡した応答にする
export function respondReportingGraphQL(
  executeGraphQL: Mock,
  {
    role,
    handlers = new Map(),
  }: {
    readonly role: AdminRole;
    readonly handlers?: ReadonlyMap<unknown, ReportingGraphQLHandler>;
  },
): void {
  executeGraphQL.mockImplementation((document: unknown, variables: unknown) => {
    const handler = handlers.get(document);
    if (handler !== undefined) {
      return handler(variables);
    }
    if (document === AdminViewerDocument) {
      return Promise.resolve(adminViewerResult(adminWithRole(role)));
    }
    throw new Error('想定していない操作が実行されました。');
  });
}

export interface ReportingQueryWatch {
  readonly cases: () => boolean;
  readonly detail: () => boolean;
  readonly summaries: () => boolean;
  readonly moderationProducts: () => boolean;
  readonly moderationUsers: () => boolean;
}

// 表示していない照会は取り直されず古い印だけが付くため、照会をキャッシュに置いて操作の後に無効にされたかを読む
export function watchReportingQueries(
  queryClient: QueryClient,
): ReportingQueryWatch {
  const watched: Readonly<
    Record<
      | 'cases'
      | 'detail'
      | 'unhandled'
      | 'product'
      | 'moderationProducts'
      | 'moderationUsers',
      readonly unknown[]
    >
  > = {
    cases: adminReportCasesQueryOptions({ status: 'resolved' }).queryKey,
    detail: adminReportCaseQueryOptions(REPORT_CASE_ID).queryKey,
    unhandled: adminUnhandledReportSummaryQueryOptions().queryKey,
    product: adminProductReportSummaryQueryOptions(REPORT_PRODUCT_ID).queryKey,
    moderationProducts: adminModerationProductsQueryOptions({}).queryKey,
    moderationUsers: adminModerationUsersQueryOptions({}).queryKey,
  };
  for (const queryKey of Object.values(watched)) {
    queryClient.setQueryData(queryKey, {});
  }
  const invalidated = (queryKey: readonly unknown[]) => () =>
    queryClient.getQueryState(queryKey)?.isInvalidated ?? false;
  return {
    cases: invalidated(watched.cases),
    detail: invalidated(watched.detail),
    summaries: () =>
      invalidated(watched.unhandled)() && invalidated(watched.product)(),
    moderationProducts: invalidated(watched.moderationProducts),
    moderationUsers: invalidated(watched.moderationUsers),
  };
}

export const reportCaseNodeOf = (
  patch: Partial<AdminReportCaseSummaryFragment> = {},
): AdminReportCaseSummaryFragment => ({
  id: REPORT_CASE_ID,
  target: {
    kind: 'PRODUCT',
    id: REPORT_PRODUCT_ID,
    detached: false,
    available: true,
    handle: 'pitch-notes',
    label: 'Pitch Notes',
    excerpt: null,
    productId: null,
    productName: null,
    productHandle: null,
  },
  status: 'OPEN',
  reportCount: 3,
  categoryCounts: [
    { categoryId: '01JE0000000000000000000001', name: '権利侵害', count: 2 },
    { categoryId: '01JE0000000000000000000002', name: 'その他', count: 1 },
  ],
  firstReportedAt: '2026-11-01T00:00:00.000Z',
  lastReportedAt: '2026-11-02T03:00:00.000Z',
  infringement: true,
  responseTime: {
    startedAt: '2026-11-01T00:00:00.000Z',
    completedAt: null,
    elapsedSeconds: 4 * 60 * 60,
    alerts: [],
  },
  ...patch,
});

export const reportCasesQueryOf = (
  nodes: readonly AdminReportCaseSummaryFragment[],
): AdminReportCasesQuery => ({
  adminReportCases: {
    nodes: [...nodes],
    pageInfo: { hasNextPage: false, endCursor: null },
  },
});
