import { asc } from 'drizzle-orm';

import { launchComments } from '../../../../db/schema/engagement/launch-comments.ts';
import { productRatings } from '../../../../db/schema/engagement/product-ratings.ts';
import {
  after,
  clearEngagementTables,
  commentIdOf,
  db,
  insertComments,
  insertLaunch,
  insertProduct,
  insertRatings,
  insertUser,
  ratingIdOf,
  T0,
} from '../../../../lib/workers/engagement/testing/engagement-fixtures.ts';

export const WITHDRAWING = 1;
export const OWNER = 2;
export const OTHER = 3;

export const EARLIER_DELETED_AT = after(1_000);

const EARLIER_INVALIDATED_AT = after(2_000);

const FIRST_PRODUCT = 1;
const SECOND_PRODUCT = 2;

interface DeletionState {
  readonly id: string;
  readonly deletedAt: Date | null;
  readonly updatedAt: Date;
}

export interface WithdrawalState {
  readonly comments: readonly DeletionState[];
  readonly ratings: readonly DeletionState[];
}

// 退会する利用者はトップレベル・返信・削除済みのコメントと、2つのプロダクトへの評価(片方は無効化済み)を持ち、他の利用者はコメントと評価を1件ずつ持つ
export async function seedWithdrawalScenario(): Promise<void> {
  await clearEngagementTables();
  await insertUser(WITHDRAWING);
  await insertUser(OWNER);
  await insertUser(OTHER);
  await insertProduct(FIRST_PRODUCT, OWNER);
  await insertProduct(SECOND_PRODUCT, OWNER);
  await insertLaunch(FIRST_PRODUCT, FIRST_PRODUCT);
  await insertLaunch(SECOND_PRODUCT, SECOND_PRODUCT);
  await insertComments([
    { index: 1, product: FIRST_PRODUCT, launch: FIRST_PRODUCT, author: OWNER },
    {
      index: 2,
      product: FIRST_PRODUCT,
      launch: FIRST_PRODUCT,
      author: WITHDRAWING,
      parent: { index: 1, root: 1 },
      depth: 2,
    },
    {
      index: 3,
      product: FIRST_PRODUCT,
      launch: FIRST_PRODUCT,
      author: WITHDRAWING,
    },
    {
      index: 4,
      product: FIRST_PRODUCT,
      launch: FIRST_PRODUCT,
      author: OTHER,
      parent: { index: 3, root: 3 },
      depth: 2,
    },
    {
      index: 5,
      product: SECOND_PRODUCT,
      launch: SECOND_PRODUCT,
      author: WITHDRAWING,
      columns: { deletedAt: EARLIER_DELETED_AT },
    },
  ]);
  await insertRatings([
    { index: 1, product: FIRST_PRODUCT, user: WITHDRAWING },
    { index: 2, product: FIRST_PRODUCT, user: OTHER },
    {
      index: 3,
      product: SECOND_PRODUCT,
      user: WITHDRAWING,
      columns: { invalidatedAt: EARLIER_INVALIDATED_AT },
    },
  ]);
}

export async function readWithdrawalState(): Promise<WithdrawalState> {
  const comments = await db
    .select({
      id: launchComments.id,
      deletedAt: launchComments.deletedAt,
      updatedAt: launchComments.updatedAt,
    })
    .from(launchComments)
    .orderBy(asc(launchComments.id));
  const ratings = await db
    .select({
      id: productRatings.id,
      deletedAt: productRatings.deletedAt,
      updatedAt: productRatings.updatedAt,
    })
    .from(productRatings)
    .orderBy(asc(productRatings.id));
  return { comments, ratings };
}

function deletionOf(id: string, deletedAt: Date | null): DeletionState {
  return { id, deletedAt, updatedAt: deletedAt ?? T0 };
}

function earlierDeletedComment(): DeletionState {
  return {
    id: commentIdOf(5),
    deletedAt: EARLIER_DELETED_AT,
    updatedAt: T0,
  };
}

export function untouchedState(): WithdrawalState {
  return {
    comments: [
      deletionOf(commentIdOf(1), null),
      deletionOf(commentIdOf(2), null),
      deletionOf(commentIdOf(3), null),
      deletionOf(commentIdOf(4), null),
      earlierDeletedComment(),
    ],
    ratings: [
      deletionOf(ratingIdOf(1), null),
      deletionOf(ratingIdOf(2), null),
      deletionOf(ratingIdOf(3), null),
    ],
  };
}

export function withdrawnState(at: Date): WithdrawalState {
  return {
    comments: [
      deletionOf(commentIdOf(1), null),
      deletionOf(commentIdOf(2), at),
      deletionOf(commentIdOf(3), at),
      deletionOf(commentIdOf(4), null),
      earlierDeletedComment(),
    ],
    ratings: [
      deletionOf(ratingIdOf(1), at),
      deletionOf(ratingIdOf(2), null),
      deletionOf(ratingIdOf(3), at),
    ],
  };
}
