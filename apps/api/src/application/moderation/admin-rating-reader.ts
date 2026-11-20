import { inject, injectable } from 'inversify';

import type { RatingScore } from '../../../common-lib/engagement/engagement-rules.ts';
import { ENGAGEMENT_PLATFORM_TYPES } from '../../../lib/core/engagement/identifiers.ts';
import type {
  AdminRatingDirectory,
  AdminRatingRecord,
  AdminRatingSearchFilter,
  AdminRatingState,
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

export interface AdminRatingListFilter {
  // プロダクトの詳細の評価の一覧が渡す。productHandleと別のプロダクトを指すと結果は空になる
  readonly productId?: string;
  // 旧ハンドルはそのプロダクトとして扱う
  readonly productHandle?: string;
  // 旧ハンドルはその利用者として扱う
  readonly raterHandle?: string;
  readonly state?: AdminRatingState;
}

export interface AdminRatingRater {
  readonly userId: string;
  readonly handle: string;
  readonly nickname: string;
  readonly suspended: boolean;
}

export interface AdminRatingInvalidationNote {
  readonly reason: string | null;
  readonly occurredAt: Date;
}

export interface AdminRatingItem {
  readonly ratingId: string;
  readonly productId: string;
  // 論理削除済みのプロダクトはnull
  readonly productName: string | null;
  // 退会済み・物理削除済みの評価者はnull
  readonly rater: AdminRatingRater | null;
  readonly score: RatingScore;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly state: AdminRatingState;
  readonly invalidatedAt: Date | null;
  // 無効化中で、無効化の措置の記録が残っている評価だけが持つ
  readonly latestInvalidation: AdminRatingInvalidationNote | null;
}

export interface AdminRatingPage {
  readonly ratings: readonly AdminRatingItem[];
  readonly nextCursor: string | null;
}

// 権限の確認と件数(1〜50)の検証は呼び出し側のリゾルバが行う
export interface AdminRatingReader {
  // 評価者が取り消した評価を除き、更新の新しい順。不正なafterは上流のAppError(bad_request, invalid_cursor)をそのまま投げる
  list(input: {
    readonly filter: AdminRatingListFilter;
    readonly first: number;
    readonly after?: string;
  }): Promise<AdminRatingPage>;
}

const EMPTY_PAGE: AdminRatingPage = Object.freeze({
  ratings: [],
  nextCursor: null,
});

const raterOf = (
  user: UserSummaryRecord | undefined,
): AdminRatingRater | null =>
  user === undefined
    ? null
    : {
        userId: user.userId,
        handle: user.handle,
        nickname: user.nickname,
        suspended: user.suspended,
      };

interface PageDetails {
  readonly raters: ReadonlyMap<string, UserSummaryRecord>;
  readonly products: ReadonlyMap<string, ProductSummaryRecord>;
  readonly invalidations: ReadonlyMap<string, LatestModeration>;
}

@injectable()
export class DefaultAdminRatingReader implements AdminRatingReader {
  constructor(
    @inject(ENGAGEMENT_PLATFORM_TYPES.AdminRatingDirectory)
    private readonly directory: AdminRatingDirectory,
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
  }: Parameters<AdminRatingReader['list']>[0]): Promise<AdminRatingPage> {
    const searchFilter = await this.#searchFilterOf(filter);
    if (searchFilter === null) {
      return EMPTY_PAGE;
    }
    const { ratings, nextCursor } = await this.directory.search(
      searchFilter,
      after === undefined ? { limit: first } : { after, limit: first },
    );
    if (ratings.length === 0) {
      return { ratings: [], nextCursor };
    }
    const details = await this.#detailsOf(ratings);
    return {
      ratings: ratings.map((record) => this.#itemOf(record, details)),
      nextCursor,
    };
  }

  // ハンドルに該当する利用者・プロダクトがいない、またはプロダクトのIDとハンドルが食い違えばnull
  async #searchFilterOf({
    productId,
    productHandle,
    raterHandle,
    state,
  }: AdminRatingListFilter): Promise<AdminRatingSearchFilter | null> {
    const [product, rater] = await Promise.all([
      productHandle === undefined
        ? undefined
        : this.products.resolveHandle(productHandle),
      raterHandle === undefined
        ? undefined
        : this.profiles.resolveHandle(raterHandle),
    ]);
    if (product?.kind === 'none' || rater?.kind === 'none') {
      return null;
    }
    const resolvedProductId = product?.product.productId ?? productId;
    if (productId !== undefined && resolvedProductId !== productId) {
      return null;
    }
    return {
      ...(resolvedProductId === undefined
        ? {}
        : { productId: resolvedProductId }),
      ...(rater === undefined ? {} : { userId: rater.user.userId }),
      ...(state === undefined ? {} : { state }),
    };
  }

  // 評価の数に比例した問い合わせをしないため、ページの評価者・プロダクト・無効化の記録をそれぞれ1回の照会で読む
  async #detailsOf(
    ratings: readonly AdminRatingRecord[],
  ): Promise<PageDetails> {
    const invalidatedIds = ratings
      .filter(({ invalidatedAt }) => invalidatedAt !== null)
      .map(({ ratingId }) => ratingId);
    const [raters, products, invalidations] = await Promise.all([
      this.profiles.findSummaries(
        [...new Set(ratings.map(({ userId }) => userId))],
        'not-withdrawn',
      ),
      this.products.findSummaries(
        [...new Set(ratings.map(({ productId }) => productId))],
        'not-deleted',
      ),
      invalidatedIds.length === 0
        ? new Map<string, LatestModeration>()
        : this.records.latestFor({
            targetIds: invalidatedIds,
            actions: ['rating.invalidate'],
          }),
    ]);
    return { raters, products, invalidations };
  }

  #itemOf(
    record: AdminRatingRecord,
    { raters, products, invalidations }: PageDetails,
  ): AdminRatingItem {
    const invalidation =
      record.invalidatedAt === null
        ? undefined
        : invalidations.get(record.ratingId);
    return {
      ratingId: record.ratingId,
      productId: record.productId,
      productName: products.get(record.productId)?.name ?? null,
      rater: raterOf(raters.get(record.userId)),
      score: record.score,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      state: record.invalidatedAt === null ? 'valid' : 'invalidated',
      invalidatedAt: record.invalidatedAt,
      latestInvalidation:
        invalidation === undefined
          ? null
          : {
              reason: invalidation.reason,
              occurredAt: invalidation.occurredAt,
            },
    };
  }
}
