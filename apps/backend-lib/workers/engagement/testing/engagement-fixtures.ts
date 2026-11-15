import { eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';

import { launchComments } from '../../../../db/schema/engagement/launch-comments.ts';
import { productRatings } from '../../../../db/schema/engagement/product-ratings.ts';
import {
  after,
  clearProductTables,
  db,
  insertLaunch,
  insertProduct,
  insertUser,
  launchIdOf,
  productIdOf,
  T0,
  userIdOf,
} from '../../product/testing/product-fixtures.ts';

export {
  after,
  db,
  insertLaunch,
  insertProduct,
  insertUser,
  launchIdOf,
  productIdOf,
  T0,
  userIdOf,
};

type CommentRow = typeof launchComments.$inferInsert;
type RatingRow = typeof productRatings.$inferInsert;

// 1行が最大14個のバインド変数を使うため、上限(100)に収まる行数ずつ追加する
const COMMENT_ROWS_PER_INSERT = 7;

// 1行が最大8個のバインド変数を使う
const RATING_ROWS_PER_INSERT = 12;

function insertsOf<T>(rows: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, index) =>
    rows.slice(index * size, (index + 1) * size),
  );
}

export const COMMENT_GUARD_VIOLATION =
  /NOT NULL constraint failed: launch_comments\.product_id/u;

export const RATING_GUARD_VIOLATION =
  /NOT NULL constraint failed: product_ratings\.product_id/u;

export async function runBatch(
  items: readonly [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]],
): Promise<void> {
  await db.batch(items);
}

export function changesOf(result: unknown): number {
  if (
    typeof result === 'object' &&
    result !== null &&
    'meta' in result &&
    typeof result.meta === 'object' &&
    result.meta !== null &&
    'changes' in result.meta &&
    typeof result.meta.changes === 'number'
  ) {
    return result.meta.changes;
  }
  throw new TypeError('D1の書き込みの結果に変更の件数がありません');
}

export function commentIdOf(index: number): string {
  return `01JD0CMNT${String(index).padStart(17, '0')}`;
}

export interface CommentFixture {
  readonly index: number;
  readonly product: number;
  readonly launch: number;
  // 紐付けを解除した投稿者はnull
  readonly author: number | null;
  // トップレベルは省く
  readonly parent?: { readonly index: number; readonly root: number };
  readonly depth?: 1 | 2 | 3;
  readonly columns?: Partial<CommentRow>;
}

function commentRowOf(fixture: CommentFixture): CommentRow {
  return {
    id: commentIdOf(fixture.index),
    productId: productIdOf(fixture.product),
    launchId: launchIdOf(fixture.launch),
    parentId:
      fixture.parent === undefined ? null : commentIdOf(fixture.parent.index),
    rootId: commentIdOf(fixture.parent?.root ?? fixture.index),
    depth: fixture.depth ?? 1,
    authorUserId: fixture.author === null ? null : userIdOf(fixture.author),
    body: `コメント${String(fixture.index)}`,
    createdAt: T0,
    updatedAt: T0,
    ...fixture.columns,
  };
}

export async function insertComment(fixture: CommentFixture): Promise<void> {
  await db.insert(launchComments).values(commentRowOf(fixture));
}

export async function insertComments(
  fixtures: readonly CommentFixture[],
): Promise<void> {
  const [first, ...rest] = insertsOf(
    fixtures.map(commentRowOf),
    COMMENT_ROWS_PER_INSERT,
  ).map((rows) => db.insert(launchComments).values(rows));
  if (first !== undefined) {
    await db.batch([first, ...rest]);
  }
}

export async function readComment(index: number) {
  const [row] = await db
    .select()
    .from(launchComments)
    .where(eq(launchComments.id, commentIdOf(index)));
  return row;
}

export async function countComments(): Promise<number> {
  return db.$count(launchComments);
}

export function ratingIdOf(index: number): string {
  return `01JD0RATE${String(index).padStart(17, '0')}`;
}

export interface RatingFixture {
  readonly index: number;
  readonly product: number;
  readonly user: number;
  readonly score?: 1 | 2 | 3 | 4 | 5;
  readonly columns?: Partial<RatingRow>;
}

function ratingRowOf(fixture: RatingFixture): RatingRow {
  return {
    id: ratingIdOf(fixture.index),
    productId: productIdOf(fixture.product),
    userId: userIdOf(fixture.user),
    score: fixture.score ?? 3,
    createdAt: T0,
    updatedAt: T0,
    ...fixture.columns,
  };
}

export async function insertRating(fixture: RatingFixture): Promise<void> {
  await db.insert(productRatings).values(ratingRowOf(fixture));
}

export async function insertRatings(
  fixtures: readonly RatingFixture[],
): Promise<void> {
  const [first, ...rest] = insertsOf(
    fixtures.map(ratingRowOf),
    RATING_ROWS_PER_INSERT,
  ).map((rows) => db.insert(productRatings).values(rows));
  if (first !== undefined) {
    await db.batch([first, ...rest]);
  }
}

export async function readRating(index: number) {
  const [row] = await db
    .select()
    .from(productRatings)
    .where(eq(productRatings.id, ratingIdOf(index)));
  return row;
}

export async function readRatingsOf(product: number) {
  return db
    .select()
    .from(productRatings)
    .where(eq(productRatings.productId, productIdOf(product)));
}

export async function countRatings(): Promise<number> {
  return db.$count(productRatings);
}

export async function clearEngagementTables(): Promise<void> {
  await db.delete(productRatings);
  await db.delete(launchComments);
  await clearProductTables();
}
