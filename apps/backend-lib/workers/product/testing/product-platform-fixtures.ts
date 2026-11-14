import { parseBusinessDate } from '../../../core/time/business-time.ts';
import {
  insertLaunch,
  insertProduct,
  insertProductEvent,
  insertUser,
  launchIdOf,
  productEventIdOf,
  productIdOf,
  userIdOf,
} from './product-fixtures.ts';

export const SAMPLE_OWNER_ID = userIdOf(1);
export const SAMPLE_PRODUCT_ID = productIdOf(1);
export const SAMPLE_LAUNCH_ID = launchIdOf(1);
export const SAMPLE_EVENT_ID = productEventIdOf(1);
export const SAMPLE_LAUNCH_DATE = parseBusinessDate('2026-11-20');

// 投稿者1人のプロダクト1件と、その結果が未確定のローンチ1件・未完了のライフサイクルイベント1件を作る
export async function seedProductPlatformSample(): Promise<void> {
  await insertUser(1, { handle: 'alice' });
  await insertProduct(1, 1, { handle: 'Alpha', name: 'アルファ' });
  await insertLaunch(1, 1, { launchDate: SAMPLE_LAUNCH_DATE });
  await insertProductEvent(1, 1, { ownerUserId: SAMPLE_OWNER_ID });
}
