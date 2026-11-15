import { inject, injectable } from 'inversify';

import { ENGAGEMENT_PLATFORM_TYPES } from '../../../lib/core/engagement/identifiers.ts';
import type {
  CommentStore,
  CommentThreadPage,
  CommentThreadQuery,
} from '../../../lib/core/engagement/ports.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import type { ProductDirectory } from '../../../lib/core/product/ports.ts';
import {
  type CommentThreadView,
  toCommentViews,
} from '../../domain/engagement/comment-threads.ts';
import {
  type CommentThreadPosition,
  decodeCommentThreadCursor,
  encodeCommentThreadCursor,
} from './comment-thread-cursor.ts';
import type { EngagementTargetResolver } from './engagement-target-resolver.ts';
import { ENGAGEMENT_TYPES } from './engagement-types.ts';

export interface CommentPageInput {
  readonly productId: string;
  readonly launchId: string;
  readonly viewer: CurrentUser | undefined;
  readonly after: string | undefined;
  readonly now: Date;
}

export interface CommentPage {
  readonly threads: readonly CommentThreadView[];
  readonly endCursor: string | null;
  readonly hasNextPage: boolean;
}

export interface CommentCountsInput {
  readonly productId: string;
  readonly viewer: CurrentUser | undefined;
  readonly now: Date;
}

export interface LaunchCommentCount {
  readonly launchId: string;
  readonly count: number;
}

export interface CommentReader {
  // 閲覧できないプロダクトと、別のプロダクト・取消・存在しないローンチはnull。カーソルの誤りはinvalid_cursor
  page(input: CommentPageInput): Promise<CommentPage | null>;
  // 閲覧できないプロダクトはnull。取消を除く全てのローンチを、表示できるコメントが無ければ0で返す
  counts(
    input: CommentCountsInput,
  ): Promise<readonly LaunchCommentCount[] | null>;
}

@injectable()
export class StoreCommentReader implements CommentReader {
  constructor(
    @inject(ENGAGEMENT_TYPES.EngagementTargetResolver)
    private readonly targets: EngagementTargetResolver,
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
    @inject(ENGAGEMENT_PLATFORM_TYPES.CommentThreadQuery)
    private readonly threads: CommentThreadQuery,
    @inject(ENGAGEMENT_PLATFORM_TYPES.CommentStore)
    private readonly comments: CommentStore,
  ) {}

  async page(input: CommentPageInput): Promise<CommentPage | null> {
    const { productId, launchId, viewer, now } = input;
    const after =
      input.after === undefined
        ? undefined
        : decodeCommentThreadCursor(input.after);
    const viewerUserId = viewer?.user.id;
    const [target, page] = await Promise.all([
      this.targets.resolve({ productId, launchId, viewerUserId, now }),
      this.threads.page({ launchId, after }),
    ]);
    if (target?.launch === undefined) {
      return null;
    }
    const end = await this.#endPositionOf(page);
    if (end === null) {
      return null;
    }
    return {
      threads: toCommentViews({
        threads: page.threads,
        ownerUserId: target.product.ownerUserId,
        viewerUserId,
      }),
      endCursor: end === undefined ? null : encodeCommentThreadCursor(end),
      hasNextPage: page.hasNextPage,
    };
  }

  async counts(
    input: CommentCountsInput,
  ): Promise<readonly LaunchCommentCount[] | null> {
    const { productId, viewer, now } = input;
    const [target, launches, counts] = await Promise.all([
      this.targets.resolve({ productId, viewerUserId: viewer?.user.id, now }),
      this.products.listLaunches([productId], now),
      this.threads.countsByLaunch(productId),
    ]);
    if (target === undefined) {
      return null;
    }
    return (launches.get(productId) ?? [])
      .filter(
        (launch) =>
          launch.productId === productId && launch.status !== 'canceled',
      )
      .map(({ launchId }) => ({ launchId, count: counts.get(launchId) ?? 0 }));
  }

  // ページが空ならundefined。置き換え表示の行は日時を持たないため記録から読み、記録が無ければ(プロダクトの物理削除の後)null
  async #endPositionOf(
    page: CommentThreadPage,
  ): Promise<CommentThreadPosition | undefined | null> {
    const last = page.threads.at(-1)?.root;
    if (last === undefined) {
      return undefined;
    }
    if (last.kind === 'shown') {
      return { createdAt: last.createdAt.getTime(), commentId: last.commentId };
    }
    const records = await this.comments.findByIds([last.commentId]);
    const record = records.get(last.commentId);
    return record === undefined
      ? null
      : { createdAt: record.createdAt.getTime(), commentId: last.commentId };
  }
}
