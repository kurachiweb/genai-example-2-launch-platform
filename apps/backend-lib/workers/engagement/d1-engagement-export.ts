import { and, asc, eq, isNull } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { launchComments } from '../../../db/schema/engagement/launch-comments.ts';
import { productRatings } from '../../../db/schema/engagement/product-ratings.ts';
import type { RatingScore } from '../../../common-lib/engagement/engagement-rules.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  CommentExport,
  CommentExportRecord,
  RatingExport,
  RatingExportRecord,
} from '../../core/engagement/ports.ts';

@injectable()
export class D1CommentExport implements CommentExport {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async listByUser(userId: string): Promise<readonly CommentExportRecord[]> {
    const rows = await this.db
      .select({
        id: launchComments.id,
        productId: launchComments.productId,
        launchId: launchComments.launchId,
        parentId: launchComments.parentId,
        bodyMarkdown: launchComments.body,
        createdAt: launchComments.createdAt,
        editedAt: launchComments.editedAt,
        deletedAt: launchComments.deletedAt,
        hiddenAt: launchComments.hiddenAt,
      })
      .from(launchComments)
      .where(
        and(
          eq(launchComments.authorUserId, userId),
          isNull(launchComments.anonymizedAt),
        ),
      )
      .orderBy(asc(launchComments.createdAt), asc(launchComments.id));
    return rows.map(({ hiddenAt, ...row }) => ({
      ...row,
      hiddenByAdmin: hiddenAt !== null,
    }));
  }
}

@injectable()
export class D1RatingExport implements RatingExport {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async listByUser(userId: string): Promise<readonly RatingExportRecord[]> {
    const rows = await this.db
      .select({
        productId: productRatings.productId,
        score: productRatings.score,
        invalidatedAt: productRatings.invalidatedAt,
        createdAt: productRatings.createdAt,
        updatedAt: productRatings.updatedAt,
      })
      .from(productRatings)
      .where(
        and(
          eq(productRatings.userId, userId),
          isNull(productRatings.deletedAt),
        ),
      )
      .orderBy(asc(productRatings.createdAt), asc(productRatings.id));
    // 値はテーブルのCHECK制約で1〜5に限られる
    return rows.map(({ invalidatedAt, score, ...row }) => ({
      ...row,
      score: score as RatingScore,
      invalidatedByAdmin: invalidatedAt !== null,
    }));
  }
}
