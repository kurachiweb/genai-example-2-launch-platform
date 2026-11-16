import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { ENGAGEMENT_PLATFORM_TYPES } from '../../../lib/core/engagement/identifiers.ts';
import type { CommentSoftDelete } from '../../../lib/core/engagement/ports.ts';
import type { CommentStatements } from '../../../lib/workers/engagement/comment-statements.ts';
import { isEngagementGuardViolation } from '../../../lib/workers/engagement/engagement-guard.ts';
import type { RatingStatements } from '../../../lib/workers/engagement/rating-statements.ts';
import type {
  CommentPostWrite,
  CommentUpdateOutcome,
  CommentUpdateWrite,
  CommentWriter,
  WriteOutcome,
} from '../../application/engagement/ports.ts';

// 文の部品の型はD1の結果の型を持たないため、一括の書き込みの結果から変更の件数を絞り出す
function changesOf(result: unknown): number {
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

@injectable()
export class D1CommentWriter implements CommentWriter {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(ENGAGEMENT_PLATFORM_TYPES.CommentStatements)
    private readonly comments: CommentStatements,
    @inject(ENGAGEMENT_PLATFORM_TYPES.RatingStatements)
    private readonly ratings: RatingStatements,
  ) {}

  async post(input: CommentPostWrite): Promise<WriteOutcome> {
    const results = await this.#guardedBatch(
      this.comments.insertStatement(input.comment),
      input,
    );
    return results === 'rejected' ? 'rejected' : 'committed';
  }

  // 本文の更新の文は対象の行が無くても失敗しない。行は直前の照会で確かめており、その後の物理削除はプロダクトの削除だけで、同じ一括の評価の文も条件の違反で取り消される(投稿者の削除は行を消さずに匿名化するため、本文の更新の文が条件の違反になる)
  async update(input: CommentUpdateWrite): Promise<CommentUpdateOutcome> {
    const results = await this.#guardedBatch(
      this.comments.updateBodyStatement(input.body),
      input,
    );
    if (results === 'rejected') {
      return 'rejected';
    }
    return changesOf(results[0]) === 0 ? 'not-found' : 'committed';
  }

  async remove(input: CommentSoftDelete): Promise<'deleted' | 'not-found'> {
    const results: readonly unknown[] = await this.db.batch([
      this.comments.softDeleteStatement(input),
    ]);
    return changesOf(results[0]) === 0 ? 'not-found' : 'deleted';
  }

  async #guardedBatch(
    statement: BatchItem<'sqlite'>,
    input: Pick<CommentPostWrite, 'rating'>,
  ): Promise<readonly unknown[] | 'rejected'> {
    try {
      const results: readonly unknown[] = await this.db.batch(
        input.rating === undefined
          ? [statement]
          : [statement, this.ratings.upsertStatement(input.rating)],
      );
      return results;
    } catch (error) {
      if (isEngagementGuardViolation(error)) {
        return 'rejected';
      }
      throw error;
    }
  }
}
