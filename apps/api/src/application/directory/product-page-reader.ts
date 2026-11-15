import { inject, injectable } from 'inversify';

import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import type {
  MatchDirectory,
  MatchRecord,
} from '../../../lib/core/match/ports.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import {
  type AwardGroup,
  fallbackLaunchSummary,
  type LaunchSummaryView,
} from '../../../lib/core/product/launch-summary.ts';
import type {
  LaunchRecord,
  ProductDetailRecord,
  ProductDirectory,
  ProductSummaryRecord,
} from '../../../lib/core/product/ports.ts';
import {
  type HistoryRow,
  isKickedOff,
  type MatchRecordSummary,
  summarizeRecord,
  toHistoryRows,
} from '../../domain/directory/match-history.ts';
import { DIRECTORY_TYPES } from './directory-types.ts';
import type { LaunchHighlightsReader } from './launch-highlights-reader.ts';
import { resolveProductPage } from './product-page-resolution.ts';

export interface ProductPageLaunchView extends LaunchRecord {
  readonly summary: LaunchSummaryView;
  readonly kickedOff: boolean;
  readonly latestKickedOff: boolean;
  // 結果が確定したマッチの自分の側を実施日の新しい順に
  readonly rows: readonly HistoryRow[];
}

export interface ProductPageView {
  readonly product: ProductSummaryRecord;
  readonly detail: ProductDetailRecord;
  readonly ownerView: boolean;
  readonly unlisted: boolean;
  readonly record: MatchRecordSummary;
  // Yearを先頭
  readonly awards: readonly AwardGroup[];
  // 取消を除く、ローンチ日の新しい順
  readonly launches: readonly ProductPageLaunchView[];
  // 論理削除を除いて読んだ対戦相手。行のopponentのproductIdで引く
  readonly opponents: ReadonlyMap<string, ProductSummaryRecord>;
}

export type ProductPageResult =
  | { readonly kind: 'page'; readonly view: ProductPageView }
  | { readonly kind: 'redirect'; readonly handle: string }
  | { readonly kind: 'not-found' };

export interface ProductPageReadInput {
  readonly handle: string;
  readonly viewer: CurrentUser | undefined;
  readonly now: Date;
}

export interface ProductPageReader {
  // 存在しない・未掲載の他者・閲覧できないはどれもnot-found、表示できる旧ハンドルはredirect。開催中のマッチは返さない
  read(input: ProductPageReadInput): Promise<ProductPageResult>;
}

interface MatchHistory {
  readonly matchesByLaunch: ReadonlyMap<string, readonly MatchRecord[]>;
  readonly opponents: ReadonlyMap<string, ProductSummaryRecord>;
}

const NOT_FOUND: ProductPageResult = Object.freeze({ kind: 'not-found' });

const EMPTY_HISTORY: MatchHistory = Object.freeze({
  matchesByLaunch: new Map(),
  opponents: new Map(),
});

function opponentIdsOf(
  productId: string,
  matchesByLaunch: ReadonlyMap<string, readonly MatchRecord[]>,
): readonly string[] {
  const ids = new Set<string>();
  for (const matches of matchesByLaunch.values()) {
    for (const match of matches) {
      for (const entry of match.entries) {
        if (entry.productId !== null && entry.productId !== productId) {
          ids.add(entry.productId);
        }
      }
    }
  }
  return [...ids];
}

@injectable()
export class DirectoryProductPageReader implements ProductPageReader {
  constructor(
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
    @inject(MATCH_PLATFORM_TYPES.MatchDirectory)
    private readonly matches: MatchDirectory,
    @inject(DIRECTORY_TYPES.LaunchHighlightsReader)
    private readonly highlights: LaunchHighlightsReader,
  ) {}

  async read(input: ProductPageReadInput): Promise<ProductPageResult> {
    const resolution = await resolveProductPage(
      this.products,
      input.handle,
      input.viewer,
    );
    if (resolution.kind !== 'render') {
      return resolution;
    }
    const { product } = resolution;
    const { productId } = product;
    const [detail, launchesByProduct] = await Promise.all([
      this.products.findDetail(productId),
      this.products.listLaunches([productId], input.now),
    ]);
    // 判定の後に論理削除されたプロダクトは、存在しない場合と同じにする
    if (detail === undefined) {
      return NOT_FOUND;
    }
    // 取消のローンチのマッチは履歴にも成績にも数えないため、マッチの照会に渡さない
    const launches = (launchesByProduct.get(productId) ?? []).filter(
      ({ status }) => status !== 'canceled',
    );
    const [history, highlights] = await Promise.all([
      this.#readHistory(productId, launches, input.now),
      this.highlights.read({ launches, at: input.now }),
    ]);
    const latestKickedOffId = launches.find(isKickedOff)?.launchId;
    const launchViews = launches.map((launch) => ({
      ...launch,
      summary:
        highlights.summaries.get(launch.launchId) ??
        fallbackLaunchSummary(launch),
      kickedOff: isKickedOff(launch),
      latestKickedOff: launch.launchId === latestKickedOffId,
      rows: toHistoryRows({
        productId,
        matches: history.matchesByLaunch.get(launch.launchId) ?? [],
        opponents: history.opponents,
      }),
    }));
    return {
      kind: 'page',
      view: {
        product,
        detail,
        ownerView: resolution.ownerView,
        unlisted: resolution.unlisted,
        record: summarizeRecord({
          rows: launchViews.flatMap(({ rows }) => rows),
          launches,
        }),
        awards: highlights.awards.get(productId) ?? [],
        launches: launchViews,
        opponents: history.opponents,
      },
    };
  }

  async #readHistory(
    productId: string,
    launches: readonly LaunchRecord[],
    now: Date,
  ): Promise<MatchHistory> {
    if (launches.length === 0) {
      return EMPTY_HISTORY;
    }
    const matchesByLaunch = await this.matches.listByLaunches(
      launches.map(({ launchId }) => launchId),
      now,
    );
    const opponentIds = opponentIdsOf(productId, matchesByLaunch);
    return {
      matchesByLaunch,
      opponents:
        opponentIds.length === 0
          ? new Map()
          : await this.products.findSummaries(opponentIds, 'not-deleted'),
    };
  }
}
