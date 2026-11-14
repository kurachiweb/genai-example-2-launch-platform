import { eq, or, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { userFollows } from '../../../db/schema/follow/user-follows.ts';
import { userProfileWebsites } from '../../../db/schema/profile/user-profile-websites.ts';
import { userProfiles } from '../../../db/schema/profile/user-profiles.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { previousHandleDelete } from '../../../lib/workers/handles/previous-handle-statements.ts';
import { USER_HANDLE_NAMESPACE } from '../../../lib/workers/profile/user-handle-namespace.ts';
import type { ProfilePurgeStore } from '../../application/profile/ports.ts';

@injectable()
export class D1ProfilePurgeStore implements ProfilePurgeStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async deleteFollowsBatch(userId: string, limit: number): Promise<number> {
    const targets = this.db
      .select({ id: userFollows.id })
      .from(userFollows)
      .where(
        or(
          eq(userFollows.followerId, userId),
          eq(userFollows.followeeId, userId),
        ),
      )
      .limit(limit);
    const deleted = await this.db
      .delete(userFollows)
      .where(sql`${userFollows.id} IN ${targets}`)
      .returning({ id: userFollows.id });
    return deleted.length;
  }

  async deleteProfileRows(userId: string): Promise<void> {
    await this.db.batch([
      this.db
        .delete(userProfileWebsites)
        .where(eq(userProfileWebsites.userId, userId)),
      previousHandleDelete(this.db, USER_HANDLE_NAMESPACE, userId),
      this.db.delete(userProfiles).where(eq(userProfiles.userId, userId)),
    ]);
  }
}
