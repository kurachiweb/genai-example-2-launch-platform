import { and, asc, desc, eq, inArray, isNull, lt, type SQL } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { launchComments } from '../../../db/schema/engagement/launch-comments.ts';
import { productRatings } from '../../../db/schema/engagement/product-ratings.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { EngagementErasureStore } from '../../core/engagement/ports.ts';

function deletedBeforeUnanonymized(threshold: Date): SQL | undefined {
  return and(
    lt(launchComments.deletedAt, threshold),
    isNull(launchComments.anonymizedAt),
  );
}

function anonymizedColumns(at: Date) {
  return {
    body: '',
    authorUserId: null,
    anonymizedAt: at,
    updatedAt: at,
  } as const;
}

@injectable()
export class D1EngagementErasureStore implements EngagementErasureStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  // 期限の近い行から匿名化する
  async anonymizeDeletedBefore(input: {
    readonly threshold: Date;
    readonly at: Date;
    readonly limit: 500;
  }): Promise<number> {
    const targets = this.db
      .select({ id: launchComments.id })
      .from(launchComments)
      .where(deletedBeforeUnanonymized(input.threshold))
      .orderBy(asc(launchComments.deletedAt), asc(launchComments.id))
      .limit(input.limit);
    const result = await this.db
      .update(launchComments)
      .set(anonymizedColumns(input.at))
      .where(inArray(launchComments.id, targets));
    return result.meta.changes;
  }

  async countOverdue(threshold: Date): Promise<number> {
    return this.db.$count(launchComments, deletedBeforeUnanonymized(threshold));
  }

  // 匿名化した行は投稿者を持たないため、繰り返しても未処理の行だけが対象になる
  async eraseAccount(input: {
    readonly userId: string;
    readonly at: Date;
    readonly limit: 500;
  }): Promise<{ readonly remaining: boolean }> {
    const ofAuthor = eq(launchComments.authorUserId, input.userId);
    const ofRater = eq(productRatings.userId, input.userId);
    const [, , commentsLeft, ratingsLeft] = await this.db.batch([
      this.db
        .update(launchComments)
        .set(anonymizedColumns(input.at))
        .where(
          inArray(
            launchComments.id,
            this.db
              .select({ id: launchComments.id })
              .from(launchComments)
              .where(ofAuthor)
              .limit(input.limit),
          ),
        ),
      this.db
        .delete(productRatings)
        .where(
          inArray(
            productRatings.id,
            this.db
              .select({ id: productRatings.id })
              .from(productRatings)
              .where(ofRater)
              .limit(input.limit),
          ),
        ),
      this.db
        .select({ id: launchComments.id })
        .from(launchComments)
        .where(ofAuthor)
        .limit(1),
      this.db
        .select({ id: productRatings.id })
        .from(productRatings)
        .where(ofRater)
        .limit(1),
    ]);
    return { remaining: commentsLeft.length > 0 || ratingsLeft.length > 0 };
  }

  // 階層の深い順に選ぶと、件数で区切っても消す親に子が残らず、自己参照の外部キーの検査を通る
  async eraseProduct(input: {
    readonly productId: string;
    readonly limit: 500;
  }): Promise<{ readonly remaining: boolean }> {
    const ofProductComments = eq(launchComments.productId, input.productId);
    const ofProductRatings = eq(productRatings.productId, input.productId);
    const [, , commentsLeft, ratingsLeft] = await this.db.batch([
      this.db
        .delete(productRatings)
        .where(
          inArray(
            productRatings.id,
            this.db
              .select({ id: productRatings.id })
              .from(productRatings)
              .where(ofProductRatings)
              .limit(input.limit),
          ),
        ),
      this.db
        .delete(launchComments)
        .where(
          inArray(
            launchComments.id,
            this.db
              .select({ id: launchComments.id })
              .from(launchComments)
              .where(ofProductComments)
              .orderBy(desc(launchComments.depth), asc(launchComments.id))
              .limit(input.limit),
          ),
        ),
      this.db
        .select({ id: launchComments.id })
        .from(launchComments)
        .where(ofProductComments)
        .limit(1),
      this.db
        .select({ id: productRatings.id })
        .from(productRatings)
        .where(ofProductRatings)
        .limit(1),
    ]);
    return { remaining: commentsLeft.length > 0 || ratingsLeft.length > 0 };
  }
}
