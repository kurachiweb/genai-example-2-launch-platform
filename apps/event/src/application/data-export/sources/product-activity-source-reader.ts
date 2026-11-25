import { inject, injectable } from 'inversify';

import type {
  ExportAward,
  ExportComment,
  ExportLaunch,
  ExportMatch,
  ExportProduct,
  ExportProductRef,
  ExportRating,
  ExportUpvote,
} from '../../../../lib/core/data-export/export-snapshot.ts';
import {
  chunk,
  IDS_PER_STATEMENT,
} from '../../../../lib/core/d1/statement-chunks.ts';
import { ENGAGEMENT_PLATFORM_TYPES } from '../../../../lib/core/engagement/identifiers.ts';
import type {
  CommentExport,
  RatingExport,
} from '../../../../lib/core/engagement/ports.ts';
import { MATCH_PLATFORM_TYPES } from '../../../../lib/core/match/identifiers.ts';
import type {
  MatchExport,
  MatchExportRecord,
  UpvoteExport,
} from '../../../../lib/core/match/ports.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../../lib/core/product/identifiers.ts';
import type {
  LaunchExport,
  ProductDirectory,
  ProductExport,
  ProductExportRecord,
} from '../../../../lib/core/product/ports.ts';
import { WEEK_TOURNAMENT_TYPES } from '../../../../lib/core/week-tournament/identifiers.ts';
import type { WeekAwardExport } from '../../../../lib/core/week-tournament/ports.ts';
import { YEAR_TOURNAMENT_TYPES } from '../../../../lib/core/year-tournament/identifiers.ts';
import type { YearAwardExport } from '../../../../lib/core/year-tournament/ports.ts';

export interface ProductActivitySource {
  readonly products: readonly ExportProduct[];
  readonly launches: readonly ExportLaunch[];
  readonly comments: readonly ExportComment[];
  readonly upvotes: readonly ExportUpvote[];
  readonly ratings: readonly ExportRating[];
}

interface LaunchChildren {
  readonly matches: ReadonlyMap<string, readonly MatchExportRecord[]>;
  readonly awards: ReadonlyMap<string, readonly ExportAward[]>;
}

function toExportProduct(record: ProductExportRecord): ExportProduct {
  return {
    id: record.id,
    handle: record.handle,
    name: record.name,
    tagline: record.tagline,
    categoryName: record.categoryName,
    websiteUrl: record.websiteUrl,
    descriptionMarkdown: record.descriptionMarkdown,
    logoFileId: record.logoFileId,
    screenshotFileIds: record.screenshotFileIds,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt,
    hiddenByAdmin: record.hiddenByAdmin,
  };
}

function toExportMatch(record: MatchExportRecord): ExportMatch {
  return {
    id: record.matchId,
    kind: record.kind,
    round: record.round,
    date: record.date,
    upvoteCount: record.upvoteCount,
    opponentUpvoteCount: record.opponentUpvoteCount,
    lastUpvotedAt: record.lastUpvotedAt,
    result: record.result,
  };
}

function appendAwards(
  awards: Map<string, ExportAward[]>,
  found: ReadonlyMap<string, readonly ExportAward[]>,
): void {
  for (const [launchId, launchAwards] of found) {
    awards.set(launchId, [...(awards.get(launchId) ?? []), ...launchAwards]);
  }
}

// 他のspecの出力用の部品を呼んで、利用者のプロダクト・ローンチ・コメント・Upvote・評価をスナップショットの形へ写す
@injectable()
export class ProductActivitySourceReader {
  constructor(
    @inject(PRODUCT_PLATFORM_TYPES.ProductExport)
    private readonly productExport: ProductExport,
    @inject(PRODUCT_PLATFORM_TYPES.LaunchExport)
    private readonly launchExport: LaunchExport,
    @inject(MATCH_PLATFORM_TYPES.MatchExport)
    private readonly matchExport: MatchExport,
    @inject(WEEK_TOURNAMENT_TYPES.WeekAwardExport)
    private readonly weekAwardExport: WeekAwardExport,
    @inject(YEAR_TOURNAMENT_TYPES.YearAwardExport)
    private readonly yearAwardExport: YearAwardExport,
    @inject(ENGAGEMENT_PLATFORM_TYPES.CommentExport)
    private readonly commentExport: CommentExport,
    @inject(ENGAGEMENT_PLATFORM_TYPES.RatingExport)
    private readonly ratingExport: RatingExport,
    @inject(MATCH_PLATFORM_TYPES.UpvoteExport)
    private readonly upvoteExport: UpvoteExport,
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly productDirectory: ProductDirectory,
  ) {}

  async read(userId: string, now: Date): Promise<ProductActivitySource> {
    const productRecords = await this.productExport.listByUser(userId);
    const products = productRecords.map(toExportProduct);
    const launchRecords = await this.launchExport.listByUser(userId, now);
    const children = await this.readLaunchChildren(
      launchRecords.map((launch) => launch.id),
    );
    const comments = await this.commentExport.listByUser(userId);
    const ratings = await this.ratingExport.listByUser(userId);
    const upvotes = await this.upvoteExport.listByUser(userId);

    const refs = await this.resolveProductRefs(products, [
      ...comments.map((comment) => comment.productId),
      ...ratings.map((rating) => rating.productId),
      ...upvotes.map((upvote) => upvote.productId),
    ]);
    const refOf = (productId: string | null): ExportProductRef | null =>
      productId === null ? null : (refs.get(productId) ?? null);

    return {
      products,
      launches: launchRecords.map((launch) => ({
        id: launch.id,
        productId: launch.productId,
        launchDate: launch.launchDate,
        status: launch.status,
        matches: (children.matches.get(launch.id) ?? []).map(toExportMatch),
        awards: children.awards.get(launch.id) ?? [],
      })),
      comments: comments.map((comment) => ({
        id: comment.id,
        launchId: comment.launchId,
        product: refOf(comment.productId),
        parentCommentId: comment.parentId,
        bodyMarkdown: comment.bodyMarkdown,
        createdAt: comment.createdAt,
        editedAt: comment.editedAt,
        deletedAt: comment.deletedAt,
        hiddenByAdmin: comment.hiddenByAdmin,
      })),
      upvotes: upvotes.map((upvote) => ({
        matchId: upvote.matchId,
        matchKind: upvote.matchKind,
        matchDate: upvote.matchDate,
        product: refOf(upvote.productId),
        upvotedAt: upvote.upvotedAt,
      })),
      ratings: ratings.map((rating) => ({
        product: refOf(rating.productId),
        score: rating.score,
        invalidatedByAdmin: rating.invalidatedByAdmin,
        createdAt: rating.createdAt,
        updatedAt: rating.updatedAt,
      })),
    };
  }

  // D1のバインド変数の上限に収まるよう、ローンチのIDを分けて3つの部品へ渡す。受賞は週間・年間の順に並べる
  private async readLaunchChildren(
    launchIds: readonly string[],
  ): Promise<LaunchChildren> {
    const matches = new Map<string, readonly MatchExportRecord[]>();
    const awards = new Map<string, ExportAward[]>();
    for (const ids of chunk(launchIds, IDS_PER_STATEMENT)) {
      for (const [launchId, found] of await this.matchExport.listForLaunches(
        ids,
      )) {
        matches.set(launchId, found);
      }
      appendAwards(awards, await this.weekAwardExport.listForLaunches(ids));
      appendAwards(awards, await this.yearAwardExport.listForLaunches(ids));
    }
    return { matches, awards };
  }

  // 自分のプロダクトは論理削除済みでも自分の記録から引き、他のプロダクトだけを項目の数によらず1回の照会で引く。論理削除済みや存在しないプロダクトは含めない
  private async resolveProductRefs(
    ownProducts: readonly ExportProduct[],
    activityProductIds: readonly (string | null)[],
  ): Promise<ReadonlyMap<string, ExportProductRef>> {
    const refs = new Map<string, ExportProductRef>(
      ownProducts.map((product) => [
        product.id,
        { name: product.name, handle: product.handle },
      ]),
    );
    const foreignIds = [
      ...new Set(
        activityProductIds.filter(
          (id): id is string => id !== null && !refs.has(id),
        ),
      ),
    ];
    if (foreignIds.length === 0) {
      return refs;
    }
    const summaries = await this.productDirectory.findSummaries(
      foreignIds,
      'not-deleted',
    );
    for (const [productId, summary] of summaries) {
      refs.set(productId, { name: summary.name, handle: summary.handle });
    }
    return refs;
  }
}
