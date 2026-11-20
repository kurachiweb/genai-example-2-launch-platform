import { inject, injectable } from 'inversify';

import { ENGAGEMENT_PLATFORM_TYPES } from '../../../lib/core/engagement/identifiers.ts';
import type {
  AdminCommentDirectory,
  AdminCommentRecord,
  AdminCommentSearchFilter,
  AdminCommentState,
} from '../../../lib/core/engagement/ports.ts';
import { MODERATION_PLATFORM_TYPES } from '../../../lib/core/moderation/identifiers.ts';
import type {
  LatestModeration,
  ModerationRecordStore,
} from '../../../lib/core/moderation/ports.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import type {
  ProductDirectory,
  ProductSummaryRecord,
} from '../../../lib/core/product/ports.ts';
import { PROFILE_PLATFORM_TYPES } from '../../../lib/core/profile/identifiers.ts';
import type {
  UserProfileDirectory,
  UserSummaryRecord,
} from '../../../lib/core/profile/ports.ts';

export interface AdminCommentListFilter {
  // 旧ハンドルはその利用者として扱う
  readonly authorHandle?: string;
  // 旧ハンドルはそのプロダクトとして扱う
  readonly productHandle?: string;
  // 含む
  readonly postedFrom?: Date;
  // 含まない
  readonly postedBefore?: Date;
  readonly state?: AdminCommentState;
}

export interface AdminCommentAuthor {
  readonly userId: string;
  readonly handle: string;
  readonly nickname: string;
  readonly suspended: boolean;
}

export interface AdminCommentHideNote {
  readonly reason: string | null;
  readonly occurredAt: Date;
}

export interface AdminCommentItem {
  readonly commentId: string;
  readonly productId: string;
  readonly launchId: string;
  // 論理削除済みのプロダクトはnull
  readonly productName: string | null;
  // 匿名化・退会済み・物理削除済みの投稿者はnull
  readonly author: AdminCommentAuthor | null;
  // マークダウンとして描画しない生の文字列
  readonly excerpt: string;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
  readonly state: AdminCommentState;
  // 非公開化中で、非公開化の措置の記録が残っているコメントだけが持つ
  readonly latestHide: AdminCommentHideNote | null;
}

export interface AdminCommentPage {
  readonly comments: readonly AdminCommentItem[];
  readonly nextCursor: string | null;
}

// 権限の確認と件数(1〜50)の検証は呼び出し側のリゾルバが行う
export interface AdminCommentReader {
  // 投稿の新しい順。不正なafterは上流のAppError(bad_request, invalid_cursor)をそのまま投げる
  list(input: {
    readonly filter: AdminCommentListFilter;
    readonly first: number;
    readonly after?: string;
  }): Promise<AdminCommentPage>;
}

const EMPTY_PAGE: AdminCommentPage = Object.freeze({
  comments: [],
  nextCursor: null,
});

const authorOf = (
  user: UserSummaryRecord | undefined,
): AdminCommentAuthor | null =>
  user === undefined
    ? null
    : {
        userId: user.userId,
        handle: user.handle,
        nickname: user.nickname,
        suspended: user.suspended,
      };

interface PageDetails {
  readonly authors: ReadonlyMap<string, UserSummaryRecord>;
  readonly products: ReadonlyMap<string, ProductSummaryRecord>;
  readonly hides: ReadonlyMap<string, LatestModeration>;
}

@injectable()
export class DefaultAdminCommentReader implements AdminCommentReader {
  constructor(
    @inject(ENGAGEMENT_PLATFORM_TYPES.AdminCommentDirectory)
    private readonly directory: AdminCommentDirectory,
    @inject(PROFILE_PLATFORM_TYPES.UserProfileDirectory)
    private readonly profiles: UserProfileDirectory,
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
    @inject(MODERATION_PLATFORM_TYPES.ModerationRecordStore)
    private readonly records: ModerationRecordStore,
  ) {}

  async list({
    filter,
    first,
    after,
  }: Parameters<AdminCommentReader['list']>[0]): Promise<AdminCommentPage> {
    const searchFilter = await this.#searchFilterOf(filter);
    if (searchFilter === null) {
      return EMPTY_PAGE;
    }
    const { comments, nextCursor } = await this.directory.search(
      searchFilter,
      after === undefined ? { limit: first } : { after, limit: first },
    );
    if (comments.length === 0) {
      return { comments: [], nextCursor };
    }
    const details = await this.#detailsOf(comments);
    return {
      comments: comments.map((record) => this.#itemOf(record, details)),
      nextCursor,
    };
  }

  // ハンドルに該当する利用者・プロダクトがいなければnull
  async #searchFilterOf({
    authorHandle,
    productHandle,
    ...rest
  }: AdminCommentListFilter): Promise<AdminCommentSearchFilter | null> {
    const [author, product] = await Promise.all([
      authorHandle === undefined
        ? undefined
        : this.profiles.resolveHandle(authorHandle),
      productHandle === undefined
        ? undefined
        : this.products.resolveHandle(productHandle),
    ]);
    if (author?.kind === 'none' || product?.kind === 'none') {
      return null;
    }
    return {
      ...rest,
      ...(author === undefined ? {} : { authorUserId: author.user.userId }),
      ...(product === undefined
        ? {}
        : { productId: product.product.productId }),
    };
  }

  // コメントの数に比例した問い合わせをしないため、ページの投稿者・プロダクト・非公開化の記録をそれぞれ1回の照会で読む
  async #detailsOf(
    comments: readonly AdminCommentRecord[],
  ): Promise<PageDetails> {
    const authorIds = [
      ...new Set(
        comments.flatMap(({ authorUserId }) =>
          authorUserId === null ? [] : [authorUserId],
        ),
      ),
    ];
    const hiddenIds = comments
      .filter(({ state }) => state === 'hidden')
      .map(({ commentId }) => commentId);
    const [authors, products, hides] = await Promise.all([
      authorIds.length === 0
        ? new Map<string, UserSummaryRecord>()
        : this.profiles.findSummaries(authorIds, 'not-withdrawn'),
      this.products.findSummaries(
        [...new Set(comments.map(({ productId }) => productId))],
        'not-deleted',
      ),
      hiddenIds.length === 0
        ? new Map<string, LatestModeration>()
        : this.records.latestFor({
            targetIds: hiddenIds,
            actions: ['comment.hide'],
          }),
    ]);
    return { authors, products, hides };
  }

  #itemOf(
    record: AdminCommentRecord,
    { authors, products, hides }: PageDetails,
  ): AdminCommentItem {
    const hide =
      record.state === 'hidden' ? hides.get(record.commentId) : undefined;
    return {
      commentId: record.commentId,
      productId: record.productId,
      launchId: record.launchId,
      productName: products.get(record.productId)?.name ?? null,
      author:
        record.authorUserId === null
          ? null
          : authorOf(authors.get(record.authorUserId)),
      excerpt: record.excerpt,
      createdAt: record.createdAt,
      editedAt: record.editedAt,
      state: record.state,
      latestHide:
        hide === undefined
          ? null
          : { reason: hide.reason, occurredAt: hide.occurredAt },
    };
  }
}
