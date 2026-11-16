import { inject, injectable } from 'inversify';

import type { RatingScore } from '../../../common-lib/engagement/engagement-rules.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { ENGAGEMENT_PLATFORM_TYPES } from '../../../lib/core/engagement/identifiers.ts';
import type { RatingStore } from '../../../lib/core/engagement/ports.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { engagementError } from './engagement-errors.ts';
import type {
  EngagementTarget,
  EngagementTargetResolver,
} from './engagement-target-resolver.ts';
import { ENGAGEMENT_TYPES } from './engagement-types.ts';
import type { RatingWriter } from './ports.ts';
import {
  type ProductRatingView,
  readProductRatingView,
} from './product-rating-view.ts';

export interface RatingReadInput {
  readonly productId: string;
  readonly viewer: CurrentUser | undefined;
  readonly now: Date;
}

// 評価の値の検証と利用者の状態(メールアドレスの確認を含む)は呼び出し元のリゾルバが先に行う
export interface RatingRateInput {
  readonly user: CurrentUser;
  readonly productId: string;
  readonly score: RatingScore;
  readonly now: Date;
}

// 利用者の状態は呼び出し元のリゾルバが先に行う。メールアドレスの確認は求めない
export interface RatingCancelInput {
  readonly user: CurrentUser;
  readonly productId: string;
  readonly now: Date;
}

export interface RatingService {
  // 閲覧できなければnull
  read(input: RatingReadInput): Promise<ProductRatingView | null>;
  rate(input: RatingRateInput): Promise<ProductRatingView>;
  // 評価が無くても成功する
  cancel(input: RatingCancelInput): Promise<ProductRatingView>;
}

// 投稿者本人は評価できないため、閲覧者の評価を読まない
const raterOf = (
  target: EngagementTarget,
  viewerUserId: string | undefined,
): string | undefined => (target.viewerIsOwner ? undefined : viewerUserId);

@injectable()
export class StoreRatingService implements RatingService {
  constructor(
    @inject(ENGAGEMENT_TYPES.EngagementTargetResolver)
    private readonly targets: EngagementTargetResolver,
    @inject(ENGAGEMENT_PLATFORM_TYPES.RatingStore)
    private readonly ratings: RatingStore,
    @inject(ENGAGEMENT_TYPES.RatingWriter)
    private readonly writer: RatingWriter,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
  ) {}

  async read(input: RatingReadInput): Promise<ProductRatingView | null> {
    const { productId, now } = input;
    const viewerUserId = input.viewer?.user.id;
    const target = await this.targets.resolve({
      productId,
      viewerUserId,
      now,
    });
    if (target === undefined) {
      return null;
    }
    return readProductRatingView(this.ratings, {
      productId,
      viewerUserId: raterOf(target, viewerUserId),
    });
  }

  async rate(input: RatingRateInput): Promise<ProductRatingView> {
    const { user, productId, score, now } = input;
    const userId = user.user.id;
    const target = await this.#target(input);
    if (target.viewerIsOwner) {
      throw engagementError('rating_own_product');
    }
    const outcome = await this.writer.upsert({
      ratingId: this.ids.generate(),
      productId,
      userId,
      score,
      at: now,
    });
    if (outcome === 'rejected') {
      // 所有者は変わらないため、読み直してプロダクトを閲覧できれば、残る条件は利用者の状態である
      await this.#target(input);
      throw engagementError('account_unavailable');
    }
    return readProductRatingView(this.ratings, {
      productId,
      viewerUserId: userId,
    });
  }

  async cancel(input: RatingCancelInput): Promise<ProductRatingView> {
    const { user, productId } = input;
    const userId = user.user.id;
    const target = await this.#target(input);
    await this.ratings.remove({ productId, userId });
    return readProductRatingView(this.ratings, {
      productId,
      viewerUserId: raterOf(target, userId),
    });
  }

  // 閲覧できない理由を区別せずに見つからないとする
  async #target(input: {
    readonly user: CurrentUser;
    readonly productId: string;
    readonly now: Date;
  }): Promise<EngagementTarget> {
    const target = await this.targets.resolve({
      productId: input.productId,
      viewerUserId: input.user.user.id,
      now: input.now,
    });
    if (target === undefined) {
      throw engagementError('rating_target_not_found');
    }
    return target;
  }
}
