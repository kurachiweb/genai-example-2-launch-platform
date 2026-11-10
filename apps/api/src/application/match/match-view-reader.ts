import { inject, injectable } from 'inversify';

import { teamColorIndexOf } from '../../../common-lib/match/team-colors.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import type { EntryResult } from '../../../lib/core/match/match-model.ts';
import type {
  MatchDirectory,
  MatchEntryRecord,
  MatchRecord,
} from '../../../lib/core/match/ports.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import type {
  ProductDirectory,
  ProductSummaryRecord,
} from '../../../lib/core/product/ports.ts';
import {
  type UpvoteRestriction,
  viewerRestriction,
} from '../../domain/match/upvote-plan.ts';
import { MATCH_TYPES } from './match-types.ts';
import type { MatchBoardStore } from './ports.ts';
import { upvoteViewerOf } from './upvote-viewer.ts';

export interface MatchProductView {
  readonly productId: string;
  readonly handle: string;
  readonly name: string;
  readonly tagline: string;
  readonly categoryId: string;
  readonly websiteUrl: string;
  readonly logoFileId: string;
  readonly listed: boolean;
}

export interface MatchEntryView {
  readonly entryId: string;
  // 非公開化・投稿者の退会や停止・論理削除・紐付けの解除で表示できなければnull
  readonly product: MatchProductView | null;
  readonly isViewerOwn: boolean;
  readonly upvoteCount: number;
  readonly result: EntryResult | null;
  readonly colorIndex: number;
}

export interface MatchView {
  readonly record: MatchRecord;
  // 側の番号の順
  readonly entries: readonly MatchEntryView[];
  readonly viewerUpvotedEntryId: string | null;
  readonly viewerRestriction: UpvoteRestriction | null;
}

export interface MatchViewReader {
  // 見つからないマッチは結果に含めない
  findViews(input: {
    readonly matchIds: readonly string[];
    readonly viewer: CurrentUser | undefined;
    readonly now: Date;
  }): Promise<ReadonlyMap<string, MatchView>>;
  // 呼び出し元が照会済みのマッチの記録から組み立てる
  assemble(input: {
    readonly records: readonly MatchRecord[];
    readonly viewer: CurrentUser | undefined;
  }): Promise<ReadonlyMap<string, MatchView>>;
}

export function productViewOf(summary: ProductSummaryRecord): MatchProductView {
  return {
    productId: summary.productId,
    handle: summary.handle,
    name: summary.name,
    tagline: summary.tagline,
    categoryId: summary.category.id,
    websiteUrl: summary.websiteUrl,
    logoFileId: summary.logoFileId,
    listed: summary.listed,
  };
}

@injectable()
export class DirectoryMatchViewReader implements MatchViewReader {
  constructor(
    @inject(MATCH_PLATFORM_TYPES.MatchDirectory)
    private readonly matches: MatchDirectory,
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
    @inject(MATCH_TYPES.MatchBoardStore)
    private readonly board: MatchBoardStore,
  ) {}

  async findViews(input: {
    readonly matchIds: readonly string[];
    readonly viewer: CurrentUser | undefined;
    readonly now: Date;
  }): Promise<ReadonlyMap<string, MatchView>> {
    const records = await this.matches.findMatches(input.matchIds, input.now);
    return this.assemble({
      records: [...records.values()],
      viewer: input.viewer,
    });
  }

  async assemble(input: {
    readonly records: readonly MatchRecord[];
    readonly viewer: CurrentUser | undefined;
  }): Promise<ReadonlyMap<string, MatchView>> {
    const { records, viewer } = input;
    if (records.length === 0) {
      return new Map();
    }
    const productIds = records.flatMap((record) =>
      record.entries.flatMap((entry) =>
        entry.productId === null ? [] : [entry.productId],
      ),
    );
    const matchIds = records.map((record) => record.matchId);
    const [summaries, upvotes] = await Promise.all([
      productIds.length === 0
        ? Promise.resolve(new Map<string, ProductSummaryRecord>())
        : this.products.findSummaries(productIds, 'visible'),
      viewer === undefined
        ? Promise.resolve(new Map<string, string>())
        : this.board.viewerUpvotes(matchIds, viewer.user.id),
    ]);
    const upvoteViewer = upvoteViewerOf(viewer);
    const entryViewOf = (entry: MatchEntryRecord): MatchEntryView => {
      const summary =
        entry.productId === null ? undefined : summaries.get(entry.productId);
      return {
        entryId: entry.entryId,
        product: summary?.visible === true ? productViewOf(summary) : null,
        isViewerOwn:
          upvoteViewer !== null && entry.ownerUserId === upvoteViewer.userId,
        upvoteCount: entry.upvoteCount,
        result: entry.result,
        colorIndex: teamColorIndexOf(entry.productId),
      };
    };
    return new Map(
      records.map((record) => [
        record.matchId,
        {
          record,
          entries: record.entries.map(entryViewOf),
          viewerUpvotedEntryId: upvotes.get(record.matchId) ?? null,
          viewerRestriction: viewerRestriction({
            viewer: upvoteViewer,
            phase: record.phase,
            ownerUserIds: record.entries.map((entry) => entry.ownerUserId),
          }),
        },
      ]),
    );
  }
}
