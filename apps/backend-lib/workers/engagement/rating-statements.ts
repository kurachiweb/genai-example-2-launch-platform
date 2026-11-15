import { and, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { productRatings } from '../../../db/schema/engagement/product-ratings.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { verifiedUsers } from '../../../db/schema/identity/visibility.ts';
import { products } from '../../../db/schema/product/products.ts';
import {
  visibleProducts,
  wonLaunchExists,
} from '../../../db/schema/product/visibility.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { RatingUpsert } from '../../core/engagement/ports.ts';
import {
  guardedProductId,
  isEngagementGuardViolation,
} from './engagement-guard.ts';

// apiのinfrastructure層が一括の書き込みへ並べる文を返す。条件の違反はproduct_ratings.product_idのNOT NULLの違反として一括の書き込み全体を取り消す
export interface RatingStatements {
  // 同じ利用者とプロダクトの行があれば値と更新の日時だけを上書きし、無効化の印を保つ
  upsertStatement(input: RatingUpsert): BatchItem<'sqlite'>;
  // 変更したときだけ渡した文を同じ一括の書き込みで確定する。論理削除された行は存在しないものとして扱う
  setInvalidated(
    input: RatingInvalidationChange,
  ): Promise<RatingInvalidationResult>;
}

export interface RatingInvalidationChange {
  readonly ratingId: string;
  readonly invalidated: boolean;
  readonly at: Date;
  readonly statements?: readonly BatchItem<'sqlite'>[];
}

export type RatingInvalidationResult = 'changed' | 'unchanged' | 'not-found';

// 自身のプロダクトの拒否はproducts.user_idを条件に使わず、ユースケースが所有者で先に判定する
function ratingAllowed(input: RatingUpsert): SQL {
  return sql`(${and(
    sql`EXISTS (SELECT 1 FROM ${products} INNER JOIN ${users} ON ${eq(users.id, products.userId)} WHERE ${and(
      eq(products.id, input.productId),
      visibleProducts(),
      wonLaunchExists(),
    )})`,
    sql`EXISTS (SELECT 1 FROM ${users} WHERE ${and(
      eq(users.id, input.userId),
      verifiedUsers(),
    )})`,
  )})`;
}

@injectable()
export class D1RatingStatements implements RatingStatements {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  // NOT NULLの検査は一意の衝突の判定より先に行われるため、既存の行があっても条件の違反で失敗する
  upsertStatement(input: RatingUpsert): BatchItem<'sqlite'> {
    return this.db
      .insert(productRatings)
      .values({
        id: input.ratingId,
        productId: guardedProductId(ratingAllowed(input), input.productId),
        userId: input.userId,
        score: input.score,
        createdAt: input.at,
        updatedAt: input.at,
      })
      .onConflictDoUpdate({
        target: [productRatings.productId, productRatings.userId],
        set: { score: input.score, updatedAt: input.at },
      });
  }

  async setInvalidated(
    input: RatingInvalidationChange,
  ): Promise<RatingInvalidationResult> {
    const current = await this.#invalidatedOf(input.ratingId);
    if (current === undefined) {
      return 'not-found';
    }
    if (current === input.invalidated) {
      return 'unchanged';
    }
    try {
      await this.db.batch([
        this.#invalidationUpdate(input),
        ...(input.statements ?? []),
      ]);
      return 'changed';
    } catch (error) {
      if (!isEngagementGuardViolation(error)) {
        throw error;
      }
      const reread = await this.#invalidatedOf(input.ratingId);
      if (reread === undefined) {
        return 'not-found';
      }
      if (reread === input.invalidated) {
        return 'unchanged';
      }
      throw error;
    }
  }

  async #invalidatedOf(ratingId: string): Promise<boolean | undefined> {
    const [row] = await this.db
      .select({ invalidatedAt: productRatings.invalidatedAt })
      .from(productRatings)
      .where(
        and(eq(productRatings.id, ratingId), isNull(productRatings.deletedAt)),
      );
    return row === undefined ? undefined : row.invalidatedAt !== null;
  }

  // 状態を読んだ後に別の操作が同じ状態へ変えた・評価者の退会で論理削除されていれば、渡した文ごと一括の書き込みを取り消す
  #invalidationUpdate(input: RatingInvalidationChange): BatchItem<'sqlite'> {
    const stillOpposite = and(
      input.invalidated
        ? isNull(productRatings.invalidatedAt)
        : isNotNull(productRatings.invalidatedAt),
      isNull(productRatings.deletedAt),
    );
    return this.db
      .update(productRatings)
      .set({
        productId: guardedProductId(
          sql`(${stillOpposite})`,
          productRatings.productId,
        ),
        invalidatedAt: input.invalidated ? input.at : null,
        updatedAt: input.at,
      })
      .where(eq(productRatings.id, input.ratingId));
  }
}
