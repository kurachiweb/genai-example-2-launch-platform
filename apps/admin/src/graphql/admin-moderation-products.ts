import type { QueryClient } from '@tanstack/react-query';
import { notFound } from '@tanstack/react-router';

import {
  ADMIN_LIST_PAGE_SIZE,
  type ModerationAction,
} from '../../common-lib/moderation/moderation-actions.ts';
import {
  ADMIN_LAUNCH_STATES,
  type AdminProductLaunchState as AdminProductLaunchStateValue,
} from '../../common-lib/moderation/moderation-labels.ts';
import type { RouterContext } from '../../lib/start/router-context.ts';
import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import { GraphQLClientError } from '../../lib/utilities/graphql/graphql-result.ts';
import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import { adminProductRatingsQueryOptions } from './admin-moderation-engagement.ts';
import {
  type AdminMediaFileView,
  type AdminModerationPage,
  type AdminUserSummaryView,
  type ModerationActionOptions,
  moderationActionOptions,
  type ModerationNoteView,
  toAdminMediaFile,
  toAdminUserSummary,
  toModerationNote,
  toModerationPage,
} from './admin-moderation-shared.ts';
import {
  AdminHideProductDocument,
  AdminModerationCategoryOptionsDocument,
  type AdminModerationCategoryOptionsQuery,
  type AdminModerationProductFragment,
  AdminProductDocument,
  type AdminProductFilter,
  type AdminProductLaunchState,
  type AdminProductQuery,
  AdminProductsDocument,
  type AdminProductsQuery,
  type AdminProductsQueryVariables,
  type AdminProductVisibility,
  AdminUnhideProductDocument,
} from './generated/graphql.ts';

export type AdminProductVisibilityValue =
  'visible' | 'hidden' | 'owner_suspended';

export interface AdminModerationProductFilter {
  readonly name?: string | undefined;
  readonly handle?: string | undefined;
  readonly ownerHandle?: string | undefined;
  readonly categoryId?: string | undefined;
  readonly launchState?: AdminProductLaunchStateValue | undefined;
  readonly visibility?: AdminProductVisibilityValue | undefined;
}

export interface AdminModerationProductListArgs extends AdminModerationProductFilter {
  readonly after?: string | undefined;
}

export interface ModerationCategoryOption {
  readonly id: string;
  readonly name: string;
}

export interface AdminModerationProductView {
  readonly id: string;
  readonly handle: string;
  readonly name: string;
  readonly logo: AdminMediaFileView | null;
  // nullは退会済みの投稿者
  readonly owner: AdminUserSummaryView | null;
  readonly category: ModerationCategoryOption;
  // 業務日付。nullはローンチが無い
  readonly latestLaunchDate: string | null;
  readonly latestLaunchState: AdminProductLaunchStateValue | null;
  readonly visibility: AdminProductVisibilityValue;
}

export type AdminModerationProductPage =
  AdminModerationPage<AdminModerationProductView>;

// 種別・ステージ・勝敗は上流の値のまま持つ
export interface AdminModerationMatchView {
  readonly id: string;
  readonly kind: string;
  readonly round: number | null;
  readonly stage: string | null;
  readonly matchDate: string;
  readonly upvoteCount: number;
  // nullは未確定
  readonly result: string | null;
  // 照会の時点の進み具合(scheduled・live・tallying・finished)
  readonly phase: string;
  // 決着の仕方。nullは未確定
  readonly decision: string | null;
  // nullは不戦勝・表示できない相手
  readonly opponentName: string | null;
}

export interface AdminModerationLaunchView {
  readonly id: string;
  readonly number: number;
  readonly launchDate: string;
  // nullは画面が表示名を持たない状態
  readonly state: AdminProductLaunchStateValue | null;
  readonly matches: readonly AdminModerationMatchView[];
}

export interface AdminModerationProductDetailView {
  readonly product: AdminModerationProductView;
  readonly tagline: string;
  readonly descriptionMarkdown: string;
  readonly websiteUrl: string;
  readonly screenshots: readonly AdminMediaFileView[];
  readonly hiddenAt: string | null;
  // 非公開化中で、非公開化の措置の記録が残っているプロダクトだけが持つ
  readonly latestHide: ModerationNoteView | null;
  readonly ratingSummary: {
    readonly average: number | null;
    readonly count: number;
  };
  // ローンチ日の新しい順
  readonly launches: readonly AdminModerationLaunchView[];
}

export type ProductModerationAction = Extract<
  ModerationAction,
  `product.${string}`
>;

type GraphQLProductDetail = NonNullable<AdminProductQuery['adminProduct']>;

type GraphQLLaunch = GraphQLProductDetail['launches'][number];

const LAUNCH_STATE_OF = Object.freeze({
  SCHEDULED: 'scheduled',
  IN_PROGRESS: 'in_progress',
  WON: 'won',
  LOST: 'lost',
  CANCELED: 'canceled',
} as const satisfies Record<
  AdminProductLaunchState,
  AdminProductLaunchStateValue
>);

const GRAPHQL_LAUNCH_STATE_OF = Object.freeze({
  scheduled: 'SCHEDULED',
  in_progress: 'IN_PROGRESS',
  won: 'WON',
  lost: 'LOST',
  canceled: 'CANCELED',
} as const satisfies Record<
  AdminProductLaunchStateValue,
  AdminProductLaunchState
>);

const VISIBILITY_OF = Object.freeze({
  VISIBLE: 'visible',
  HIDDEN: 'hidden',
  OWNER_SUSPENDED: 'owner_suspended',
} as const satisfies Record<
  AdminProductVisibility,
  AdminProductVisibilityValue
>);

const GRAPHQL_VISIBILITY_OF = Object.freeze({
  visible: 'VISIBLE',
  hidden: 'HIDDEN',
  owner_suspended: 'OWNER_SUSPENDED',
} as const satisfies Record<
  AdminProductVisibilityValue,
  AdminProductVisibility
>);

const variablesOf = ({
  name,
  handle,
  ownerHandle,
  categoryId,
  launchState,
  visibility,
  after,
}: AdminModerationProductListArgs): AdminProductsQueryVariables => {
  const filter: AdminProductFilter = {
    ...(name !== undefined && { name }),
    ...(handle !== undefined && { handle }),
    ...(ownerHandle !== undefined && { ownerHandle }),
    ...(categoryId !== undefined && { categoryId }),
    ...(launchState !== undefined && {
      launchState: GRAPHQL_LAUNCH_STATE_OF[launchState],
    }),
    ...(visibility !== undefined && {
      visibility: GRAPHQL_VISIBILITY_OF[visibility],
    }),
  };
  return {
    filter,
    first: ADMIN_LIST_PAGE_SIZE,
    ...(after !== undefined && { after }),
  };
};

export const adminModerationProductsQueryOptions = (
  args: AdminModerationProductListArgs,
) => graphqlQueryOptions(AdminProductsDocument, variablesOf(args));

export const adminModerationProductQueryOptions = (id: string) =>
  graphqlQueryOptions(AdminProductDocument, { id });

export const adminModerationCategoryOptionsQueryOptions = () =>
  graphqlQueryOptions(AdminModerationCategoryOptionsDocument, {});

const toProduct = (
  node: AdminModerationProductFragment,
): AdminModerationProductView => ({
  id: node.id,
  handle: node.handle,
  name: node.name,
  logo: toAdminMediaFile(node.logo),
  owner: toAdminUserSummary(node.owner),
  category: { id: node.category.id, name: node.category.name },
  latestLaunchDate: node.latestLaunchDate,
  latestLaunchState:
    node.latestLaunchState === null
      ? null
      : LAUNCH_STATE_OF[node.latestLaunchState],
  visibility: VISIBILITY_OF[node.visibility],
});

const isLaunchState = (value: string): value is AdminProductLaunchStateValue =>
  (ADMIN_LAUNCH_STATES as readonly string[]).includes(value);

// ローンチの状態はAPIが列挙ではなく上流の値の文字列で返すため、表示名を持つ値だけに絞る
const toLaunch = (launch: GraphQLLaunch): AdminModerationLaunchView => ({
  id: launch.id,
  number: launch.number,
  launchDate: launch.launchDate,
  state: isLaunchState(launch.status) ? launch.status : null,
  matches: launch.matches.map((match) => ({
    id: match.id,
    kind: match.kind,
    round: match.round,
    stage: match.stage,
    matchDate: match.matchDate,
    upvoteCount: match.upvoteCount,
    result: match.result,
    phase: match.phase,
    decision: match.decision,
    opponentName: match.opponentName,
  })),
});

export const toAdminModerationProductPage = ({
  adminProducts,
}: AdminProductsQuery): AdminModerationProductPage =>
  toModerationPage(adminProducts, toProduct);

export const toAdminModerationProductDetail = ({
  adminProduct,
}: AdminProductQuery): AdminModerationProductDetailView | null =>
  adminProduct === null
    ? null
    : {
        product: toProduct(adminProduct.product),
        tagline: adminProduct.tagline,
        descriptionMarkdown: adminProduct.descriptionMarkdown,
        websiteUrl: adminProduct.websiteUrl,
        screenshots: adminProduct.screenshots.map((file) =>
          toAdminMediaFile(file),
        ),
        hiddenAt: adminProduct.hiddenAt,
        latestHide: toModerationNote(adminProduct.latestHide),
        ratingSummary: {
          average: adminProduct.ratingSummary.average,
          count: adminProduct.ratingSummary.count,
        },
        launches: adminProduct.launches.map(toLaunch),
      };

export const toModerationCategoryOptions = ({
  adminModerationCategoryOptions,
}: AdminModerationCategoryOptionsQuery): readonly ModerationCategoryOption[] =>
  adminModerationCategoryOptions.map(({ id, name }) => ({ id, name }));

const PRODUCT_ACTION_OPTIONS: Readonly<
  Record<ProductModerationAction, ModerationActionOptions>
> = Object.freeze({
  'product.hide': moderationActionOptions({
    document: AdminHideProductDocument,
    variablesOf: ({ targetId, reason }) => ({ id: targetId, reason }),
    outcomeOf: ({ hideProduct }) => hideProduct,
  }),
  'product.unhide': moderationActionOptions({
    document: AdminUnhideProductDocument,
    variablesOf: ({ targetId, reason }) => ({ id: targetId, reason }),
    outcomeOf: ({ unhideProduct }) => unhideProduct,
  }),
});

export const productModerationActionOptions = (
  action: ProductModerationAction,
): ModerationActionOptions => PRODUCT_ACTION_OPTIONS[action];

export async function invalidateAdminModerationProductQueries(
  queryClient: QueryClient,
): Promise<void> {
  await Promise.all(
    [
      documentIdOf(AdminProductsDocument),
      documentIdOf(AdminProductDocument),
    ].map((documentId) =>
      queryClient.invalidateQueries({ queryKey: [documentId] }),
    ),
  );
}

// 一覧と絞り込みのカテゴリの選択肢の取得の失敗は、一覧と絞り込みの中で再試行できるよう、例外にせずキャッシュに残す
export async function loadAdminModerationProductsPage({
  context,
  deps,
}: {
  readonly context: Pick<RouterContext, 'queryClient'>;
  readonly deps: AdminModerationProductListArgs;
}): Promise<void> {
  await Promise.all([
    context.queryClient
      .query(adminModerationCategoryOptionsQueryOptions())
      .catch(() => undefined),
    context.queryClient
      .query(adminModerationProductsQueryOptions(deps))
      .catch(() => undefined),
  ]);
}

const VALIDATION_ERROR = 'validation_error';

const PRODUCT_ID_FIELD = 'id';

// APIサーバーはIDの形式の違反をnullではなく入力の検証の失敗で返すため、不在と同じ見つからない表示にする
const isMalformedProductId = (error: unknown): boolean =>
  error instanceof GraphQLClientError &&
  error.code === VALIDATION_ERROR &&
  (error.details ?? []).some(({ field }) => field === PRODUCT_ID_FIELD);

// 詳細が無ければページを表示できないため、詳細の取得の失敗はルートのエラーの画面に任せる。評価の一覧の取得の失敗は評価の区画の中で再試行できるよう、例外にせずキャッシュに残す
export async function loadAdminModerationProductPage({
  context,
  params,
}: {
  readonly context: Pick<RouterContext, 'queryClient'>;
  readonly params: { readonly productId: string };
}): Promise<void> {
  const [data] = await Promise.all([
    context.queryClient
      .query(adminModerationProductQueryOptions(params.productId))
      .catch((error: unknown) => {
        if (isMalformedProductId(error)) {
          throw notFound();
        }
        throw error;
      }),
    context.queryClient
      .infiniteQuery(adminProductRatingsQueryOptions(params.productId))
      .catch(() => undefined),
  ]);
  if (data.adminProduct === null) {
    throw notFound();
  }
}
