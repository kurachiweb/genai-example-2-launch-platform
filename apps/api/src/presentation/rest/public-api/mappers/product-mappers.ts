import { DIRECTORY_PAGE_SIZE } from '../../../../../common-lib/directory/directory-query-rules.ts';
import { verifiedExternalUrl } from '../../../../../common-lib/url/external-url.ts';
import type { AwardGroup } from '../../../../../lib/core/product/launch-summary.ts';
import type {
  ProductCategoryRecord,
  ProductSummaryRecord,
} from '../../../../../lib/core/product/ports.ts';
import type {
  DirectoryItemView,
  DirectoryPageView,
} from '../../../../application/directory/directory-reader.ts';
import type {
  ProductPageLaunchView,
  ProductPageView,
} from '../../../../application/directory/product-page-reader.ts';
import type {
  HistoryRow,
  OpponentView,
} from '../../../../domain/directory/match-history.ts';
import type { LoadedMedia, MediaLookupRequest } from '../media-lookup.ts';
import type {
  Launch,
  LaunchMatch,
  LaunchMatchOpponent,
  ProductCategory,
  ProductDetail,
  ProductListItem,
} from '../schemas/products.ts';
import {
  LOGO_IMAGE_VARIANT,
  type PublicApiOrigins,
  productPageUrl,
  SCREENSHOT_IMAGE_VARIANT,
  toApiImage,
  userSummaryOf,
} from './common-mappers.ts';

export interface ProductListPage {
  readonly data: ProductListItem[];
  readonly meta: {
    readonly total: number;
    readonly page: number;
    readonly per_page: number;
    readonly total_pages: number;
  };
}

type ProductFields = Omit<ProductListItem, 'base_win'>;

const NO_OPPONENT: LaunchMatchOpponent = Object.freeze({ kind: 'none' });

const PRIVATE_OPPONENT: LaunchMatchOpponent = Object.freeze({
  kind: 'private',
});

export const toProductCategory = (
  category: Pick<ProductCategoryRecord, 'handle' | 'name'>,
): ProductCategory => ({ handle: category.handle, name: category.name });

const toAwards = (awards: readonly AwardGroup[]): ProductListItem['awards'] =>
  awards.map(({ kind, count }) => ({ kind, count }));

// 上流のビューは投稿者を識別子だけで持つため、表示情報は一括の照会の結果から引く
function toProductFields(
  product: ProductSummaryRecord,
  awards: readonly AwardGroup[],
  loaded: LoadedMedia,
  origins: PublicApiOrigins,
): ProductFields {
  return {
    id: product.productId,
    handle: product.handle,
    name: product.name,
    tagline: product.tagline,
    category: toProductCategory(product.category),
    website_url: verifiedExternalUrl(product.websiteUrl) ?? '',
    logo: toApiImage(
      loaded.files.get(product.logoFileId),
      LOGO_IMAGE_VARIANT,
      origins.images,
    ),
    owner: userSummaryOf(product.ownerUserId, loaded, origins),
    awards: toAwards(awards),
    page_url: productPageUrl(origins.site, product.handle),
  };
}

const toProductListItem = (
  item: DirectoryItemView,
  loaded: LoadedMedia,
  origins: PublicApiOrigins,
): ProductListItem => ({
  ...toProductFields(item.product, item.awards, loaded, origins),
  base_win: {
    launch_date: item.baseWin.launchDate,
    kind: item.baseWin.kind,
    upvote_count: item.baseWin.upvoteCount,
  },
});

export const mediaRequestOfDirectoryPage = (
  view: DirectoryPageView,
): MediaLookupRequest => ({
  fileIds: view.items.map(({ product }) => product.logoFileId),
  userIds: view.items.map(({ product }) => product.ownerUserId),
});

export const toProductListPage = (
  view: DirectoryPageView,
  loaded: LoadedMedia,
  origins: PublicApiOrigins,
): ProductListPage => ({
  data: view.items.map((item) => toProductListItem(item, loaded, origins)),
  meta: {
    total: view.totalCount,
    page: view.page,
    per_page: DIRECTORY_PAGE_SIZE,
    total_pages: view.pageCount,
  },
});

export const mediaRequestOfProductPage = (
  view: ProductPageView,
): MediaLookupRequest => ({
  fileIds: [view.product.logoFileId, ...view.detail.screenshotFileIds],
  userIds: [view.product.ownerUserId],
});

export const toProductDetail = (
  view: ProductPageView,
  loaded: LoadedMedia,
  origins: PublicApiOrigins,
): ProductDetail => ({
  ...toProductFields(view.product, view.awards, loaded, origins),
  description_markdown: view.detail.descriptionMarkdown,
  screenshots: view.detail.screenshotFileIds.map((fileId) =>
    toApiImage(
      loaded.files.get(fileId),
      SCREENSHOT_IMAGE_VARIANT,
      origins.images,
    ),
  ),
  first_launch_date: view.record.firstLaunchDate,
  launch_count: view.record.launchCount,
  record: { wins: view.record.wins, losses: view.record.losses },
});

// 掲載中でない相手へのリンクを作らせないよう、ハンドルは掲載中の相手だけに持たせる
function toOpponent(
  opponent: OpponentView,
  opponents: ReadonlyMap<string, ProductSummaryRecord>,
): LaunchMatchOpponent {
  if (opponent.kind === 'none') {
    return NO_OPPONENT;
  }
  const product =
    opponent.kind === 'private' ? undefined : opponents.get(opponent.productId);
  if (opponent.kind === 'private' || product === undefined) {
    return PRIVATE_OPPONENT;
  }
  return opponent.kind === 'listed'
    ? { kind: 'listed', handle: product.handle, name: product.name }
    : { kind: 'unlisted', name: product.name };
}

const toLaunchMatch = (
  row: HistoryRow,
  opponents: ReadonlyMap<string, ProductSummaryRecord>,
): LaunchMatch => ({
  id: row.matchId,
  kind: row.kind,
  round: row.round,
  stage: row.stage,
  match_date: row.matchDate,
  result: row.result,
  decision: row.decision,
  ended_early: row.endedEarly,
  upvote_count: row.ownUpvoteCount,
  opponent_upvote_count: row.opponentUpvoteCount,
  opponent: toOpponent(row.opponent, opponents),
});

function toLaunch(
  launch: ProductPageLaunchView,
  opponents: ReadonlyMap<string, ProductSummaryRecord>,
): Launch {
  if (launch.status === 'canceled') {
    throw new RangeError(
      `取消のローンチはローンチ履歴に含めません: ${launch.launchId}`,
    );
  }
  return {
    id: launch.launchId,
    number: launch.number,
    launch_date: launch.launchDate,
    status: launch.status,
    summary: launch.summary.label,
    matches: launch.rows.map((row) => toLaunchMatch(row, opponents)),
  };
}

export const toLaunches = (view: ProductPageView): Launch[] =>
  view.launches.map((launch) => toLaunch(launch, view.opponents));
