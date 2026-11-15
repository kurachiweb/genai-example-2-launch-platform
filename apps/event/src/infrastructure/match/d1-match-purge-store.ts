import { eq, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { matchEntries } from '../../../db/schema/match/match-entries.ts';
import { matchUpvotes } from '../../../db/schema/match/match-upvotes.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { MatchPurgeStore } from '../../application/match/ports.ts';

@injectable()
export class D1MatchPurgeStore implements MatchPurgeStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async deleteUpvotesBatch(userId: string, limit: number): Promise<number> {
    const targets = this.db
      .select({ id: matchUpvotes.id })
      .from(matchUpvotes)
      .where(eq(matchUpvotes.userId, userId))
      .limit(limit);
    const deleted = await this.db
      .delete(matchUpvotes)
      .where(sql`${matchUpvotes.id} IN ${targets}`)
      .returning({ id: matchUpvotes.id });
    return deleted.length;
  }

  async clearOwner(userId: string): Promise<void> {
    await this.db
      .update(matchEntries)
      .set({ ownerUserId: null })
      .where(eq(matchEntries.ownerUserId, userId));
  }

  async unlinkProduct(productId: string, at: Date): Promise<void> {
    await this.db
      .update(matchEntries)
      .set({
        productId: null,
        launchId: null,
        ownerUserId: null,
        unlinkedAt: at,
        updatedAt: at,
      })
      .where(eq(matchEntries.productId, productId));
  }
}
