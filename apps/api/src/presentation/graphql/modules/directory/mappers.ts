import type {
  DirectorySort,
  DirectoryQuery,
} from '../../../../../common-lib/directory/directory-query-rules.ts';
import { checkExternalUrl } from '../../../../../common-lib/url/external-url.ts';
import type {
  DirectoryItemView,
  DirectoryPageView,
} from '../../../../application/directory/directory-reader.ts';
import type { BaseWinKind } from '../../../../domain/directory/base-win.ts';
import { type ProductAwardModel, toProductAward } from '../product/mappers.ts';

export type DirectorySortValue = 'RELEVANCE' | 'NEWEST' | 'OLDEST' | 'UPVOTES';

export type DirectoryWinKindValue = 'VICTORY' | 'BYE' | 'EARLY';

export interface DirectoryAppliedQueryModel {
  readonly q: string | null;
  readonly category: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly sort: DirectorySortValue | null;
  readonly page: number | null;
}

// カテゴリ・ロゴ・投稿者は項目のリゾルバが一括読み込みで引くため、IDだけを持つ
export interface DirectoryItemModel {
  readonly handle: string;
  readonly name: string;
  readonly tagline: string;
  readonly categoryId: string;
  readonly websiteUrl: string;
  readonly logoFileId: string;
  readonly ownerUserId: string;
  readonly isViewerOwn: boolean;
  readonly awards: ProductAwardModel[];
  readonly win: {
    readonly launchDate: string;
    readonly kind: DirectoryWinKindValue;
    readonly upvoteCount: number | null;
  };
  readonly metrics: { readonly key: string; readonly value: number }[];
}

export interface DirectoryPageModel {
  readonly applied: DirectoryAppliedQueryModel;
  readonly searchTerms: string[];
  readonly businessToday: string;
  readonly totalCount: number;
  readonly page: number;
  readonly pageCount: number;
  readonly items: DirectoryItemModel[];
}

const SORT_VALUES = Object.freeze({
  relevance: 'RELEVANCE',
  newest: 'NEWEST',
  oldest: 'OLDEST',
  upvotes: 'UPVOTES',
} as const satisfies Record<DirectorySort, DirectorySortValue>);

const WIN_KIND_VALUES = Object.freeze({
  victory: 'VICTORY',
  bye: 'BYE',
  early: 'EARLY',
} as const satisfies Record<BaseWinKind, DirectoryWinKindValue>);

// 保存の後に検証の規則が変わっても危険なリンクを出さないよう、表示の時点で検証の済まないURLを空にする
export const verifiedWebsiteUrl = (value: string): string =>
  checkExternalUrl(value) === 'ok' ? value : '';

const toAppliedQuery = (
  applied: DirectoryQuery,
): DirectoryAppliedQueryModel => ({
  q: applied.q ?? null,
  category: applied.category ?? null,
  from: applied.from ?? null,
  to: applied.to ?? null,
  sort: applied.sort === undefined ? null : SORT_VALUES[applied.sort],
  page: applied.page ?? null,
});

const toDirectoryItem = (item: DirectoryItemView): DirectoryItemModel => ({
  handle: item.product.handle,
  name: item.product.name,
  tagline: item.product.tagline,
  categoryId: item.product.category.id,
  websiteUrl: verifiedWebsiteUrl(item.product.websiteUrl),
  logoFileId: item.product.logoFileId,
  ownerUserId: item.product.ownerUserId,
  isViewerOwn: item.isViewerOwn,
  awards: item.awards.map(toProductAward),
  win: {
    launchDate: item.baseWin.launchDate,
    kind: WIN_KIND_VALUES[item.baseWin.kind],
    upvoteCount: item.baseWin.upvoteCount,
  },
  metrics: item.metrics.map(({ key, value }) => ({ key, value })),
});

export const toDirectoryPage = (
  page: DirectoryPageView,
): DirectoryPageModel => ({
  applied: toAppliedQuery(page.applied),
  searchTerms: [...page.searchTerms],
  businessToday: page.businessToday,
  totalCount: page.totalCount,
  page: page.page,
  pageCount: page.pageCount,
  items: page.items.map(toDirectoryItem),
});
