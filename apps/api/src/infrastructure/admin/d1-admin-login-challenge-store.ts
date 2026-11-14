import { and, eq, gt, inArray, lte } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { adminLoginChallenges } from '../../../db/schema/admin/admin-login-challenges.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  AdminLoginChallengeStore,
  NewAdminLoginChallenge,
} from '../../application/admin/ports.ts';

@injectable()
export class D1AdminLoginChallengeStore implements AdminLoginChallengeStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async insert(challenge: NewAdminLoginChallenge): Promise<void> {
    await this.db.insert(adminLoginChallenges).values(challenge);
  }

  async findValid(
    tokenHash: string,
    now: Date,
  ): Promise<{ readonly id: string; readonly adminId: string } | undefined> {
    const [row] = await this.db
      .select({
        id: adminLoginChallenges.id,
        adminId: adminLoginChallenges.adminId,
      })
      .from(adminLoginChallenges)
      .where(
        and(
          eq(adminLoginChallenges.tokenHash, tokenHash),
          gt(adminLoginChallenges.expiresAt, now),
        ),
      );
    return row;
  }

  async delete(id: string): Promise<void> {
    await this.db
      .delete(adminLoginChallenges)
      .where(eq(adminLoginChallenges.id, id));
  }

  async deleteExpired(now: Date, limit: number): Promise<number> {
    const expiredIds = this.db
      .select({ id: adminLoginChallenges.id })
      .from(adminLoginChallenges)
      .where(lte(adminLoginChallenges.expiresAt, now))
      .limit(limit);
    const result = await this.db
      .delete(adminLoginChallenges)
      .where(inArray(adminLoginChallenges.id, expiredIds));
    return result.meta.changes;
  }
}
