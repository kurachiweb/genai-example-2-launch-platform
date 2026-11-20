import { randomBytes } from 'node:crypto';

import type { RatingScore } from '../../apps/common-lib/engagement/engagement-rules.ts';
import { fixtureId, ID_RANDOM_BYTES } from './directory-fixture-sql.ts';
import { createListedProducts } from './directory-fixtures.ts';
import { executeLocalD1 } from './local-d1.ts';
import {
  type EngagementTargetsPlan,
  engagementTargetsInsertSql,
  moderationProductSql,
  moderationTargetsStateSql,
  type ModerationTargetsState,
  parseEngagementTargetsInsert,
  parseModerationProduct,
  parseModerationTargetsState,
  planEngagementTargets,
} from './moderation-fixture-sql.ts';

export type {
  FixtureUser,
  ModerationTargetsState,
} from './moderation-fixture-sql.ts';

export interface ModerationTargetsRequest {
  // 省くと5と1の2件にし、片方の無効化で平均が変わるようにする
  readonly ratingScores?: readonly RatingScore[];
}

export interface ModerationTargets extends EngagementTargetsPlan {
  readonly productHandle: string;
  readonly productName: string;
}

const DEFAULT_RATING_SCORES: readonly RatingScore[] = Object.freeze([5, 1]);

const SUFFIX_BYTES = 4;

const nextFixtureId = (): string =>
  fixtureId(new Date(), randomBytes(ID_RANDOM_BYTES));

// 措置の対象として、掲載中のプロダクト1件を持つ確認済みの利用者と、そのプロダクトの勝ちのローンチへの他の利用者のコメント1件と評価を直接作る。投稿者とコメント・評価の利用者はログインできない。前回の実行のデータは消さず、ハンドルの乱数の接尾辞で分ける
export async function createModerationTargets({
  ratingScores = DEFAULT_RATING_SCORES,
}: ModerationTargetsRequest = {}): Promise<ModerationTargets> {
  const {
    products: [listed],
  } = await createListedProducts({ count: 1 });
  if (listed === undefined) {
    throw new Error('掲載中のプロダクトを作れませんでした');
  }
  const product = parseModerationProduct(
    await executeLocalD1(moderationProductSql(listed.handle)),
    listed.handle,
  );
  const plan = planEngagementTargets({
    product,
    ratingScores,
    suffix: randomBytes(SUFFIX_BYTES).toString('hex'),
    now: new Date(),
    nextId: nextFixtureId,
  });
  parseEngagementTargetsInsert(
    await executeLocalD1(engagementTargetsInsertSql(plan)),
    plan,
  );
  return { ...plan, productHandle: listed.handle, productName: listed.name };
}

// 措置の後のローカルのD1の状態を、画面を介さずに確かめる
export async function readModerationTargetsState(
  targets: EngagementTargetsPlan,
): Promise<ModerationTargetsState> {
  return parseModerationTargetsState(
    await executeLocalD1(moderationTargetsStateSql(targets)),
    targets,
  );
}
