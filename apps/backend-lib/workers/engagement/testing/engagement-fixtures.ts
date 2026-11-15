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

export const COMMENT_GUARD_VIOLATION =
  /NOT NULL constraint failed: launch_comments\.product_id/u;

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

export async function insertComment(fixture: CommentFixture): Promise<void> {
  await db.insert(launchComments).values({
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
  });
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

export async function clearEngagementTables(): Promise<void> {
  await db.delete(productRatings);
  await db.delete(launchComments);
  await clearProductTables();
}
