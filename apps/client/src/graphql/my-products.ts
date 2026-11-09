import {
  type InfiniteData,
  infiniteQueryOptions,
  type QueryClient,
  queryOptions,
} from '@tanstack/react-query';

import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import { reportUnexpectedErrorInBrowser } from '../../lib/start/observability/browser-error-reporting.ts';
import {
  isExpectedFailure,
  requireData,
} from '../../lib/utilities/graphql/graphql-result.ts';
import {
  documentIdOf,
  graphqlQueryKey,
} from '../../lib/utilities/graphql/persisted-document.ts';
import type { MediaImageView } from '../../lib/utilities/media/picture-sources.ts';
import {
  ClientLaunchHistoryDocument,
  ClientMyProductDocument,
  type ClientMyProductQuery,
  ClientMyProductsDocument,
  type ClientMyProductsQuery,
  type ClientMyProductsQueryVariables,
  ClientNewProductLaunchWindowDocument,
  type ClientNewProductLaunchWindowQuery,
  ClientProductCategoriesDocument,
  type ClientProductCategoriesQuery,
  ClientProductHandleAvailabilityDocument,
  ClientProfileAwardsDocument,
  type ClientRegisterProductMutation,
  type HandleAvailability,
  type LaunchDateUnavailableReason,
  type LaunchPlanMode,
} from './generated/graphql.ts';
import {
  type ProductLaunchView,
  toProductLaunchView,
} from './product-launch.ts';
import type { ClientViewer } from './viewer.ts';

export const MY_PRODUCTS_PAGE_SIZE = 20;

export type LaunchPlanModeView = 'new' | 'reschedule' | 'blocked' | 'unknown';

export type LaunchDateUnavailableReasonView =
  'pairing_deadline' | 'relaunch_interval' | 'out_of_range';

// 日はすべて業務日付(YYYY-MM-DD)で、earliestからlatestまでのうちunavailableの範囲(両端を含む)を除く日を選べる
export interface LaunchDateWindowView {
  readonly earliest: string;
  readonly latest: string;
  readonly unavailable: readonly {
    readonly from: string;
    readonly to: string;
    readonly reason: LaunchDateUnavailableReasonView;
  }[];
  // 敗北後の間隔で最も早い日が後ろへずれるときの間隔の日数。それ以外はnull
  readonly relaunchIntervalDays: number | null;
}

export interface LaunchPlanView {
  readonly mode: LaunchPlanModeView;
  // rescheduleのときの予定のローンチ日
  readonly currentLaunchDate: string | null;
  // new・rescheduleのときの選べる日
  readonly window: LaunchDateWindowView | null;
  readonly blocks: readonly {
    readonly code: string;
    readonly message: string;
    // nullは解除の日時が分からない
    readonly releaseAt: string | null;
  }[];
  readonly locked: boolean;
  readonly locks: readonly {
    readonly code: string;
    readonly message: string;
  }[];
  // 固定の判定ができず、ローンチ日・カテゴリの変更と削除を受け付けない
  readonly lockUnknown: boolean;
  readonly ultrasEntitled: boolean;
}

export interface ProductCategoryView {
  readonly id: string;
  readonly name: string;
  readonly handle: string;
  readonly systemDefault: boolean;
}

export interface MyProductCardView {
  readonly handle: string;
  readonly name: string;
  readonly category: ProductCategoryView;
  // nullは画像の記録が無い
  readonly logo: MediaImageView | null;
  readonly hidden: boolean;
  readonly listed: boolean;
  // 取消を除く直近のローンチ
  readonly latestLaunch: ProductLaunchView | null;
  readonly plan: LaunchPlanView;
}

export interface MyProductEditView extends MyProductCardView {
  readonly previousHandle: string | null;
  readonly tagline: string;
  readonly websiteUrl: string;
  readonly description: string;
  readonly logoFileId: string;
  // 表示順
  readonly screenshots: readonly {
    readonly fileId: string;
    readonly image: MediaImageView | null;
  }[];
  // 保存と削除で送る、読み込んだ時点の版
  readonly version: number;
}

export type MyProductLookup =
  | { readonly kind: 'found'; readonly product: MyProductEditView }
  | { readonly kind: 'redirect'; readonly handle: string }
  | { readonly kind: 'not-found' };

type GraphQLMyProductNode =
  ClientMyProductsQuery['myProducts']['nodes'][number];
type GraphQLMyProductFields = ClientRegisterProductMutation['registerProduct'];
type GraphQLLaunchPlan = GraphQLMyProductNode['plan'];
type GraphQLLaunchDateWindow =
  ClientNewProductLaunchWindowQuery['newProductLaunchWindow'];

export type MyProductsData = InfiniteData<ClientMyProductsQuery, string | null>;

const PLAN_MODE_OF: Readonly<Record<LaunchPlanMode, LaunchPlanModeView>> =
  Object.freeze({
    NEW: 'new',
    RESCHEDULE: 'reschedule',
    BLOCKED: 'blocked',
    UNKNOWN: 'unknown',
  });

const UNAVAILABLE_REASON_OF: Readonly<
  Record<LaunchDateUnavailableReason, LaunchDateUnavailableReasonView>
> = Object.freeze({
  PAIRING_DEADLINE: 'pairing_deadline',
  RELAUNCH_INTERVAL: 'relaunch_interval',
  OUT_OF_RANGE: 'out_of_range',
});

const FIRST_PAGE_VARIABLES: ClientMyProductsQueryVariables = Object.freeze({
  first: MY_PRODUCTS_PAGE_SIZE,
});

// 自分のプロダクトはセッションの利用者のものであるため、同じタブで別の利用者がログインした後に前の利用者の一覧を使わないよう、共通の取得の補助のキーの後に閲覧者のIDを加える。続きのページは最後の項目のカーソルから読む
export const myProductsQueryOptions = (viewerId: string) =>
  infiniteQueryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientMyProductsDocument, FIRST_PAGE_VARIABLES),
      viewerId,
    ],
    queryFn: async ({ pageParam, signal }) =>
      requireData(
        await executeGraphQL(
          ClientMyProductsDocument,
          pageParam === null
            ? FIRST_PAGE_VARIABLES
            : { ...FIRST_PAGE_VARIABLES, after: pageParam },
          { signal },
        ),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: ({
      myProducts: { pageInfo },
    }: ClientMyProductsQuery): string | undefined =>
      pageInfo.hasNextPage && pageInfo.endCursor !== null
        ? pageInfo.endCursor
        : undefined,
  });

// 他人のプロダクトはnullになるため、一覧と同じく閲覧者ごとに分ける
export const myProductQueryOptions = (viewerId: string, handle: string) =>
  queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientMyProductDocument, { handle }),
      viewerId,
    ],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(ClientMyProductDocument, { handle }, { signal }),
      ),
  });

// 本人の画面だけで使うログインを要する照会のため、自分のプロダクトの取得とそろえて、共通の取得の補助のキーの後に閲覧者のIDを加える
export const newProductLaunchWindowQueryOptions = (viewerId: string) =>
  queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientNewProductLaunchWindowDocument, {}),
      viewerId,
    ],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(
          ClientNewProductLaunchWindowDocument,
          {},
          { signal },
        ),
      ),
  });

// カテゴリは閲覧者によらないため、共通の取得の補助をそのまま使う
export const productCategoriesQueryOptions = () =>
  graphqlQueryOptions(ClientProductCategoriesDocument, {});

export const toLaunchDateWindowView = ({
  earliest,
  latest,
  unavailable,
  relaunchIntervalDays,
}: GraphQLLaunchDateWindow): LaunchDateWindowView => ({
  earliest,
  latest,
  unavailable: unavailable.map(({ from, to, reason }) => ({
    from,
    to,
    reason: UNAVAILABLE_REASON_OF[reason],
  })),
  relaunchIntervalDays,
});

export const toLaunchPlanView = ({
  mode,
  currentLaunchDate,
  window,
  blocks,
  locked,
  locks,
  lockUnknown,
  ultrasEntitled,
}: GraphQLLaunchPlan): LaunchPlanView => ({
  mode: PLAN_MODE_OF[mode],
  currentLaunchDate,
  window: window === null ? null : toLaunchDateWindowView(window),
  blocks: blocks.map(({ code, message, releaseAt }) => ({
    code,
    message,
    releaseAt,
  })),
  locked,
  locks: locks.map(({ code, message }) => ({ code, message })),
  lockUnknown,
  ultrasEntitled,
});

const toMyProductCardView = ({
  handle,
  name,
  category,
  logo,
  hidden,
  listed,
  latestLaunch,
  plan,
}: GraphQLMyProductNode): MyProductCardView => ({
  handle,
  name,
  category,
  logo,
  hidden,
  listed,
  latestLaunch:
    latestLaunch === null ? null : toProductLaunchView(latestLaunch),
  plan: toLaunchPlanView(plan),
});

export const toMyProductCards = ({
  pages,
}: MyProductsData): readonly MyProductCardView[] =>
  pages.flatMap(({ myProducts }) => myProducts.nodes.map(toMyProductCardView));

// 照会と登録・編集の結果は同じ項目を持つため、どちらもこの形にする
export const toMyProductEditView = (
  fields: GraphQLMyProductFields,
): MyProductEditView => ({
  ...toMyProductCardView(fields),
  previousHandle: fields.previousHandle,
  tagline: fields.tagline,
  websiteUrl: fields.websiteUrl,
  description: fields.description,
  logoFileId: fields.logoFileId,
  screenshots: fields.screenshots.map(({ fileId, image }) => ({
    fileId,
    image,
  })),
  version: fields.version,
});

export const toMyProductLookup = ({
  myProduct,
}: ClientMyProductQuery): MyProductLookup => {
  if (myProduct === null) {
    return { kind: 'not-found' };
  }
  if (myProduct.__typename === 'MyProductRedirect') {
    return { kind: 'redirect', handle: myProduct.handle };
  }
  return { kind: 'found', product: toMyProductEditView(myProduct) };
};

export const toProductCategoryViews = ({
  productCategories,
}: ClientProductCategoriesQuery): readonly ProductCategoryView[] =>
  productCategories.map(({ id, name, handle, systemDefault }) => ({
    id,
    name,
    handle,
    systemDefault,
  }));

// 画面の確認は保存の可否を決めず、サーバーが保存の時に判定し直すため、確認に失敗した時は結果なしで返す。同じ値でも他の利用者の保存で変わるため、結果を保持せず毎回問い合わせる
export async function fetchProductHandleAvailability(
  queryClient: QueryClient,
  handle: string,
  productHandle?: string,
): Promise<HandleAvailability | undefined> {
  try {
    const data = await queryClient.query({
      ...graphqlQueryOptions(
        ClientProductHandleAvailabilityDocument,
        productHandle === undefined ? { handle } : { handle, productHandle },
      ),
      staleTime: 0,
      gcTime: 0,
    });
    return data.productHandleAvailability;
  } catch (error) {
    if (!isExpectedFailure(error)) {
      reportUnexpectedErrorInBrowser(error, 'render');
    }
    return undefined;
  }
}

// 取得の失敗は一覧の位置で再試行できるよう、例外にせずキャッシュに残す。続きのページはここで読み足さず、画面の「さらに読み込む」で読む
export async function loadMyProducts({
  context,
}: {
  readonly context: {
    readonly queryClient: QueryClient;
    readonly viewer: ClientViewer;
  };
}): Promise<void> {
  await context.queryClient
    .infiniteQuery(myProductsQueryOptions(context.viewer.id))
    .catch(() => undefined);
}

// プロダクトの保存・削除と業務時刻の境界は、自分のプロダクトの一覧・編集・選べる日に加え、公開プロフィールのローンチ履歴と受賞にも表れるため、それらの取得もまとめて無効にする。表示していない取得は古いものとだけされ、次に表示した時に取得し直される
export async function invalidateMyProductQueries(
  queryClient: QueryClient,
): Promise<void> {
  await Promise.all(
    [
      documentIdOf(ClientMyProductsDocument),
      documentIdOf(ClientMyProductDocument),
      documentIdOf(ClientNewProductLaunchWindowDocument),
      documentIdOf(ClientLaunchHistoryDocument),
      documentIdOf(ClientProfileAwardsDocument),
    ].map((documentId) =>
      queryClient.invalidateQueries({ queryKey: [documentId] }),
    ),
  );
}
