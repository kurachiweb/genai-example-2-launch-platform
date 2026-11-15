import { inject, injectable } from 'inversify';

import {
  DIRECTORY_PAGE_SIZE,
  type DirectoryQuery,
  effectiveSort,
  normalizeDirectoryQuery,
} from '../../../common-lib/directory/directory-query-rules.ts';
import {
  buildFtsMatchExpression,
  normalizeSearchTerms,
} from '../../../common-lib/search/search-terms.ts';
import { DIRECTORY_PLATFORM_TYPES } from '../../../lib/core/directory/identifiers.ts';
import type {
  DirectoryListingPage,
  DirectoryListingQuery,
  DirectoryListingRow,
} from '../../../lib/core/directory/ports.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import type {
  MatchDirectory,
  MatchRecord,
} from '../../../lib/core/match/ports.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import type { AwardGroup } from '../../../lib/core/product/launch-summary.ts';
import type {
  LaunchRecord,
  ProductCategoryDirectory,
  ProductCategoryRecord,
  ProductDirectory,
  ProductSummaryRecord,
} from '../../../lib/core/product/ports.ts';
import {
  type BusinessDate,
  parseBusinessDate,
  toBusinessDateTime,
} from '../../../lib/core/time/business-time.ts';
import {
  type BaseWinKind,
  classifyBaseWin,
} from '../../domain/directory/base-win.ts';
import { DIRECTORY_TYPES } from './directory-types.ts';
import type { ItemMetric, ItemMetricsReader } from './item-metrics-reader.ts';
import type { LaunchHighlightsReader } from './launch-highlights-reader.ts';

const logger = getAppLogger(['api', 'application', 'directory']);

export interface DirectoryItemBaseWin {
  readonly launchDate: BusinessDate;
  readonly kind: BaseWinKind;
  // 対戦相手のいない不戦勝はnull
  readonly upvoteCount: number | null;
}

export interface DirectoryItemView {
  readonly product: ProductSummaryRecord;
  readonly isViewerOwn: boolean;
  readonly baseWin: DirectoryItemBaseWin;
  // Yearを先頭
  readonly awards: readonly AwardGroup[];
  // 登録の順で、供給に失敗した値は含まない
  readonly metrics: readonly ItemMetric[];
}

export interface DirectoryPageView {
  // サーバーが解決したカテゴリと正規化の後の条件
  readonly applied: DirectoryQuery;
  // 名称・タグラインの強調に使う
  readonly searchTerms: readonly string[];
  readonly businessToday: BusinessDate;
  // 一覧の照会の時点の件数
  readonly totalCount: number;
  readonly page: number;
  readonly pageCount: number;
  readonly items: readonly DirectoryItemView[];
}

export interface DirectoryReadInput {
  // 文字列のままの入力で、不正な値はエラーにせず既定にする
  readonly raw: Readonly<Record<string, unknown>>;
  readonly viewer: CurrentUser | undefined;
  readonly now: Date;
}

export interface DirectoryReader {
  read(input: DirectoryReadInput): Promise<DirectoryPageView>;
}

interface ResolvedQuery {
  readonly applied: DirectoryQuery;
  readonly categoryId: string | undefined;
  readonly searchTerms: readonly string[];
}

interface PageLookups {
  readonly summaries: ReadonlyMap<string, ProductSummaryRecord>;
  readonly matchesByLaunch: ReadonlyMap<string, readonly MatchRecord[]>;
  readonly launchesByProduct: ReadonlyMap<string, readonly LaunchRecord[]>;
}

const businessDateOf = (value: string | undefined): BusinessDate | undefined =>
  value === undefined ? undefined : parseBusinessDate(value);

const qualifierOf = (
  lookups: PageLookups,
  row: DirectoryListingRow,
): MatchRecord | undefined =>
  lookups.matchesByLaunch
    .get(row.baseWin.launchId)
    ?.find(({ kind }) => kind === 'qualifier');

@injectable()
export class ListingDirectoryReader implements DirectoryReader {
  constructor(
    @inject(DIRECTORY_PLATFORM_TYPES.DirectoryListingQuery)
    private readonly listing: DirectoryListingQuery,
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
    @inject(PRODUCT_PLATFORM_TYPES.ProductCategoryDirectory)
    private readonly categories: ProductCategoryDirectory,
    @inject(MATCH_PLATFORM_TYPES.MatchDirectory)
    private readonly matches: MatchDirectory,
    @inject(DIRECTORY_TYPES.LaunchHighlightsReader)
    private readonly highlights: LaunchHighlightsReader,
    @inject(DIRECTORY_TYPES.ItemMetricsReader)
    private readonly metrics: ItemMetricsReader,
  ) {}

  async read(input: DirectoryReadInput): Promise<DirectoryPageView> {
    const { applied, categoryId, searchTerms } = await this.#resolve(input.raw);
    const page = applied.page ?? 1;
    const listed = await this.listing.page({
      matchExpression: buildFtsMatchExpression(searchTerms),
      categoryId,
      from: businessDateOf(applied.from),
      to: businessDateOf(applied.to),
      sort: effectiveSort(applied),
      page,
    });
    return {
      applied,
      searchTerms,
      businessToday: toBusinessDateTime(input.now).date,
      totalCount: listed.totalCount,
      page,
      pageCount: Math.ceil(listed.totalCount / DIRECTORY_PAGE_SIZE),
      items: await this.#items(listed, input),
    };
  }

  async #resolve(
    raw: Readonly<Record<string, unknown>>,
  ): Promise<ResolvedQuery> {
    const normalized = normalizeDirectoryQuery(raw);
    const category = await this.#findCategory(normalized.category);
    const searchTerms =
      normalized.q === undefined ? [] : normalizeSearchTerms(normalized.q);
    // NFKC正規化で空白だけになる検索語は、検索語が無いときの既定の並び順に揃える
    const applied = normalizeDirectoryQuery({
      ...normalized,
      q: searchTerms.length === 0 ? undefined : normalized.q,
      category: category?.handle,
    });
    return { applied, categoryId: category?.id, searchTerms };
  }

  async #findCategory(
    handle: string | undefined,
  ): Promise<ProductCategoryRecord | undefined> {
    return handle === undefined
      ? undefined
      : this.categories.findByHandle(handle);
  }

  async #items(
    listed: DirectoryListingPage,
    input: DirectoryReadInput,
  ): Promise<readonly DirectoryItemView[]> {
    if (listed.rows.length === 0) {
      return [];
    }
    const lookups = await this.#lookUp(listed.rows, input.now);
    // 一覧の照会の後に非公開化・停止・論理削除されたプロダクトは、件数を変えずに項目だけを除く
    const visible = listed.rows.flatMap((row) => {
      const product = lookups.summaries.get(row.productId);
      return product === undefined ? [] : [{ row, product }];
    });
    this.#warnMissingQualifiers(
      visible
        .filter(({ row }) => qualifierOf(lookups, row) === undefined)
        .map(({ row }) => row.productId),
    );
    const visibleIds = visible.map(({ row }) => row.productId);
    const [highlights, metrics] = await Promise.all([
      this.highlights.read({
        launches: visibleIds.flatMap((productId) =>
          (lookups.launchesByProduct.get(productId) ?? []).filter(
            ({ status }) => status !== 'canceled',
          ),
        ),
        at: input.now,
      }),
      this.metrics.read(visibleIds, input.now),
    ]);
    const viewerUserId = input.viewer?.user.id;
    return visible.map(({ row, product }) => {
      const kind = classifyBaseWin(
        qualifierOf(lookups, row),
        row.baseWin.launchId,
      );
      return {
        product,
        isViewerOwn: product.ownerUserId === viewerUserId,
        baseWin: {
          launchDate: row.baseWin.matchDate,
          kind,
          upvoteCount: kind === 'bye' ? null : row.baseWin.upvoteCount,
        },
        awards: highlights.awards.get(product.productId) ?? [],
        metrics: metrics.get(product.productId) ?? [],
      };
    });
  }

  async #lookUp(
    rows: readonly DirectoryListingRow[],
    now: Date,
  ): Promise<PageLookups> {
    const productIds = rows.map(({ productId }) => productId);
    const [summaries, matchesByLaunch, launchesByProduct] = await Promise.all([
      this.products.findSummaries(productIds, 'visible'),
      this.matches.listByLaunches(
        rows.map(({ baseWin }) => baseWin.launchId),
        now,
      ),
      this.products.listLaunches(productIds, now),
    ]);
    return { summaries, matchesByLaunch, launchesByProduct };
  }

  // 予選の勝利の記録から選んだ基準勝利のマッチが読めないのは物理削除との競合などの不整合のため、種類を勝利に縮退して残す
  #warnMissingQualifiers(productIds: readonly string[]): void {
    if (productIds.length === 0) {
      return;
    }
    logger.warn(
      '基準勝利の予選マッチが見つからないため、勝利として表示します',
      { count: productIds.length, productIds },
    );
  }
}
