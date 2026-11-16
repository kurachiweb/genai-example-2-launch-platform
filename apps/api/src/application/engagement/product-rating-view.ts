import type { RatingScore } from '../../../common-lib/engagement/engagement-rules.ts';
import type { RatingStore } from '../../../lib/core/engagement/ports.ts';

export interface ProductRatingView {
  readonly productId: string;
  // 丸めない平均値。有効な評価が無ければnull
  readonly average: number | null;
  readonly count: number;
  // 管理者に無効化された評価も返す
  readonly viewerScore: RatingScore | null;
}

// viewerUserIdがundefined(未ログイン・投稿者本人)なら閲覧者の評価を読まない
export async function readProductRatingView(
  ratings: RatingStore,
  input: {
    readonly productId: string;
    readonly viewerUserId: string | undefined;
  },
): Promise<ProductRatingView> {
  const { productId, viewerUserId } = input;
  const [summaries, own] = await Promise.all([
    ratings.summaries([productId]),
    viewerUserId === undefined
      ? undefined
      : ratings.findScore({ productId, userId: viewerUserId }),
  ]);
  const summary = summaries.get(productId);
  return {
    productId,
    average: summary?.average ?? null,
    count: summary?.count ?? 0,
    viewerScore: own?.score ?? null,
  };
}
