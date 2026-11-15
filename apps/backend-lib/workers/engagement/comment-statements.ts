import { and, eq, lt, sql, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { displayableComment } from '../../../db/schema/engagement/engagement-conditions.ts';
import { launchComments } from '../../../db/schema/engagement/launch-comments.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { verifiedUsers } from '../../../db/schema/identity/visibility.ts';
import { productLaunches } from '../../../db/schema/product/product-launches.ts';
import { products } from '../../../db/schema/product/products.ts';
import {
  visibleProducts,
  wonLaunchExists,
} from '../../../db/schema/product/visibility.ts';
import { COMMENT_MAX_DEPTH } from '../../../common-lib/engagement/engagement-rules.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { CommentInsert } from '../../core/engagement/ports.ts';

// apiのinfrastructure層が一括の書き込みへ並べる文を返す。条件の違反はlaunch_comments.product_idのNOT NULLの違反として一括の書き込み全体を取り消す
export interface CommentStatements {
  insertStatement(input: CommentInsert): BatchItem<'sqlite'>;
}

function targetViewable(input: CommentInsert): SQL {
  return sql`EXISTS (SELECT 1 FROM ${products} INNER JOIN ${users} ON ${eq(users.id, products.userId)} WHERE ${and(
    eq(products.id, input.productId),
    visibleProducts(),
    input.requireListed ? wonLaunchExists() : undefined,
  )})`;
}

function launchOfProduct(input: CommentInsert): SQL {
  return sql`EXISTS (SELECT 1 FROM ${productLaunches} WHERE ${and(
    eq(productLaunches.id, input.launchId),
    eq(productLaunches.productId, input.productId),
  )})`;
}

function authorVerified(input: CommentInsert): SQL {
  return sql`EXISTS (SELECT 1 FROM ${users} WHERE ${and(
    eq(users.id, input.authorUserId),
    verifiedUsers(),
  )})`;
}

// 渡したルートと階層が親の行と一致することも確かめ、返信の木の整合を書き込みの時点の行で保つ
function parentRepliable(
  input: CommentInsert,
  parent: NonNullable<CommentInsert['parent']>,
): SQL {
  return sql`EXISTS (SELECT 1 FROM ${launchComments} INNER JOIN ${users} ON ${eq(users.id, launchComments.authorUserId)} WHERE ${and(
    eq(launchComments.id, parent.commentId),
    eq(launchComments.launchId, input.launchId),
    eq(launchComments.rootId, parent.rootId),
    eq(launchComments.depth, parent.depth),
    lt(launchComments.depth, COMMENT_MAX_DEPTH),
    displayableComment(),
  )})`;
}

function postAllowed(input: CommentInsert): SQL {
  const { parent } = input;
  return sql`(${and(
    targetViewable(input),
    launchOfProduct(input),
    authorVerified(input),
    parent === null ? undefined : parentRepliable(input, parent),
  )})`;
}

@injectable()
export class D1CommentStatements implements CommentStatements {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  insertStatement(input: CommentInsert): BatchItem<'sqlite'> {
    const { parent } = input;
    return this.db.insert(launchComments).values({
      id: input.commentId,
      productId: sql`CASE WHEN ${postAllowed(input)} THEN ${input.productId} ELSE NULL END`,
      launchId: input.launchId,
      parentId: parent?.commentId ?? null,
      rootId: parent?.rootId ?? input.commentId,
      depth: parent === null ? 1 : parent.depth + 1,
      authorUserId: input.authorUserId,
      body: input.bodyMarkdown,
      createdAt: input.at,
      updatedAt: input.at,
    });
  }
}
