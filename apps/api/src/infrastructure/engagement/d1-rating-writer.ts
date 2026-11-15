import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { ENGAGEMENT_PLATFORM_TYPES } from '../../../lib/core/engagement/identifiers.ts';
import type { RatingUpsert } from '../../../lib/core/engagement/ports.ts';
import { isEngagementGuardViolation } from '../../../lib/workers/engagement/engagement-guard.ts';
import type { RatingStatements } from '../../../lib/workers/engagement/rating-statements.ts';
import type {
  RatingWriter,
  WriteOutcome,
} from '../../application/engagement/ports.ts';

@injectable()
export class D1RatingWriter implements RatingWriter {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(ENGAGEMENT_PLATFORM_TYPES.RatingStatements)
    private readonly ratings: RatingStatements,
  ) {}

  async upsert(input: RatingUpsert): Promise<WriteOutcome> {
    try {
      await this.db.batch([this.ratings.upsertStatement(input)]);
      return 'committed';
    } catch (error) {
      if (isEngagementGuardViolation(error)) {
        return 'rejected';
      }
      throw error;
    }
  }
}
