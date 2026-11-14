import {
  insertProducts,
  insertUser,
  productIdOf,
  userIdOf,
} from '../../product/testing/product-fixtures.ts';
import {
  clearDirectoryTables,
  insertQualifiers,
  winOf,
} from './directory-listing-fixtures.ts';

export const SAMPLE_OWNER_ID = userIdOf(1);
export const SAMPLE_LISTED_PRODUCT_ID = productIdOf(1);
export const SAMPLE_UNLISTED_PRODUCT_ID = productIdOf(2);
export const SAMPLE_WIN_DATE = '2026-11-20';

// 投稿者1人の、予選で勝って掲載中のプロダクトと、負けて掲載されないプロダクトを1件ずつ作る
export async function seedDirectoryPlatformSample(): Promise<void> {
  await clearDirectoryTables();
  await insertUser(1);
  await insertProducts([1, 2], 1);
  await insertQualifiers([
    winOf(1, {
      product: 1,
      owner: 1,
      date: SAMPLE_WIN_DATE,
      upvotes: 3,
      opponent: 2,
    }),
  ]);
}
