import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { ENGAGEMENT_PLATFORM_TYPES } from '../../../lib/core/engagement/identifiers.ts';
import type { CommentStatements } from '../../../lib/workers/engagement/comment-statements.ts';
import { isEngagementGuardViolation } from '../../../lib/workers/engagement/engagement-guard.ts';
import type { RatingStatements } from '../../../lib/workers/engagement/rating-statements.ts';
import type {
  CommentPostWrite,
  CommentWriter,
  WriteOutcome,
} from '../../application/engagement/ports.ts';

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
    const insertion = this.comments.insertStatement(input.comment);
    try {
      await this.db.batch(
        input.rating === undefined
          ? [insertion]
          : [insertion, this.ratings.upsertStatement(input.rating)],
      );
      return 'committed';
    } catch (error) {
      if (isEngagementGuardViolation(error)) {
        return 'rejected';
      }
      throw error;
    }
  }
}
