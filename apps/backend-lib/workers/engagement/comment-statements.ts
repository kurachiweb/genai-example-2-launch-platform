import {
  and,
  eq,
  isNotNull,
  isNull,
  lt,
  sql,
  type SQL,
  type SQLWrapper,
} from 'drizzle-orm';
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
import type {
  CommentBodyUpdate,
  CommentInsert,
  CommentSoftDelete,
} from '../../core/engagement/ports.ts';
import {
  guardedProductId,
  isEngagementGuardViolation,
} from './engagement-guard.ts';

// apiのinfrastructure層が一括の書き込みへ並べる文を返す。条件の違反はlaunch_comments.product_idのNOT NULLの違反として一括の書き込み全体を取り消す
export interface CommentStatements {
  insertStatement(input: CommentInsert): BatchItem<'sqlite'>;
  // 変更の日時を入れる。対象が存在しなければ変更の件数が0になるだけで、一括の書き込みは失敗しない
  updateBodyStatement(input: CommentBodyUpdate): BatchItem<'sqlite'>;
  // 条件を満たさない対象は変えず、変更の件数が0になる
  softDeleteStatement(input: CommentSoftDelete): BatchItem<'sqlite'>;
  // 変更したときだけ渡した文を同じ一括の書き込みで確定する
  setHidden(input: CommentHiddenChange): Promise<CommentHiddenResult>;
}

export interface CommentHiddenChange {
  readonly commentId: string;
  readonly hidden: boolean;
  readonly at: Date;
  readonly statements?: readonly BatchItem<'sqlite'>[];
}

export type CommentHiddenResult = 'changed' | 'unchanged' | 'not-found';

function targetViewable(
  productId: SQLWrapper | string,
  requireListed: boolean,
): SQL {
  return sql`EXISTS (SELECT 1 FROM ${products} INNER JOIN ${users} ON ${eq(users.id, products.userId)} WHERE ${and(
    eq(products.id, productId),
    visibleProducts(),
    requireListed ? wonLaunchExists() : undefined,
  )})`;
}

function launchOfProduct(input: CommentInsert): SQL {
  return sql`EXISTS (SELECT 1 FROM ${productLaunches} WHERE ${and(
    eq(productLaunches.id, input.launchId),
    eq(productLaunches.productId, input.productId),
  )})`;
}

function authorVerified(authorUserId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM ${users} WHERE ${and(
    eq(users.id, authorUserId),
    verifiedUsers(),
  )})`;
}

function ownUntouched(authorUserId: string): SQL {
  return sql`(${and(
    eq(launchComments.authorUserId, authorUserId),
    isNull(launchComments.deletedAt),
    isNull(launchComments.hiddenAt),
    isNull(launchComments.anonymizedAt),
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
    targetViewable(input.productId, input.requireListed),
    launchOfProduct(input),
    authorVerified(input.authorUserId),
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
      productId: guardedProductId(postAllowed(input), input.productId),
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

  // 行の印は一括の書き込みの時点の値で判定し、判定の後の削除・非公開化・停止で書き込まない
  updateBodyStatement(input: CommentBodyUpdate): BatchItem<'sqlite'> {
    const allowed = sql`(${and(
      ownUntouched(input.authorUserId),
      targetViewable(launchComments.productId, input.requireListed),
      authorVerified(input.authorUserId),
    )})`;
    return this.db
      .update(launchComments)
      .set({
        productId: guardedProductId(allowed, launchComments.productId),
        body: input.bodyMarkdown,
        editedAt: input.at,
        updatedAt: input.at,
      })
      .where(eq(launchComments.id, input.commentId));
  }

  softDeleteStatement(input: CommentSoftDelete): BatchItem<'sqlite'> {
    return this.db
      .update(launchComments)
      .set({ deletedAt: input.at, updatedAt: input.at })
      .where(
        and(
          eq(launchComments.id, input.commentId),
          ownUntouched(input.authorUserId),
        ),
      );
  }

  async setHidden(input: CommentHiddenChange): Promise<CommentHiddenResult> {
    const current = await this.#hiddenOf(input.commentId);
    if (current === undefined) {
      return 'not-found';
    }
    if (current === input.hidden) {
      return 'unchanged';
    }
    try {
      await this.db.batch([
        this.#hiddenUpdate(input),
        ...(input.statements ?? []),
      ]);
      return 'changed';
    } catch (error) {
      if (!isEngagementGuardViolation(error)) {
        throw error;
      }
      const reread = await this.#hiddenOf(input.commentId);
      if (reread === undefined) {
        return 'not-found';
      }
      if (reread === input.hidden) {
        return 'unchanged';
      }
      throw error;
    }
  }

  async #hiddenOf(commentId: string): Promise<boolean | undefined> {
    const [row] = await this.db
      .select({ hiddenAt: launchComments.hiddenAt })
      .from(launchComments)
      .where(eq(launchComments.id, commentId));
    return row === undefined ? undefined : row.hiddenAt !== null;
  }

  // 状態を読んだ後に別の操作が同じ状態へ変えていれば、渡した文ごと一括の書き込みを取り消す
  #hiddenUpdate(input: CommentHiddenChange): BatchItem<'sqlite'> {
    const stillOpposite = input.hidden
      ? isNull(launchComments.hiddenAt)
      : isNotNull(launchComments.hiddenAt);
    return this.db
      .update(launchComments)
      .set({
        productId: guardedProductId(stillOpposite, launchComments.productId),
        hiddenAt: input.hidden ? input.at : null,
        updatedAt: input.at,
      })
      .where(eq(launchComments.id, input.commentId));
  }
}
