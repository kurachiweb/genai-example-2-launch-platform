import {
  after,
  clearEngagementTables,
  commentIdOf,
  insertComment,
  insertLaunch,
  insertProduct,
  insertRating,
  insertUser,
  launchIdOf,
  productIdOf,
  ratingIdOf,
  T0,
  userIdOf,
} from './engagement-fixtures.ts';

export const SAMPLE_OWNER_ID = userIdOf(1);
export const SAMPLE_MEMBER_ID = userIdOf(2);
export const SAMPLE_PRODUCT_ID = productIdOf(1);
export const SAMPLE_LAUNCH_ID = launchIdOf(1);
export const SAMPLE_COMMENT_ID = commentIdOf(1);
export const SAMPLE_RATING_ID = ratingIdOf(1);
export const SAMPLE_RATING_SCORE = 4;

// 投稿者のプロダクトとローンチに、別の利用者のコメント1件と無効化した評価1件を作る
export async function seedEngagementPlatformSample(): Promise<void> {
  await clearEngagementTables();
  await insertUser(1, { emailVerifiedAt: T0 });
  await insertUser(2, { emailVerifiedAt: T0 });
  await insertProduct(1, 1);
  await insertLaunch(1, 1);
  await insertComment({ index: 1, product: 1, launch: 1, author: 2 });
  await insertRating({
    index: 1,
    product: 1,
    user: 2,
    score: SAMPLE_RATING_SCORE,
    columns: { invalidatedAt: after(1) },
  });
}
