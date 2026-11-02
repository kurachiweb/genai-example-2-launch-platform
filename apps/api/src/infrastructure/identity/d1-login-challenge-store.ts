import { and, eq, gt, lte } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { userLoginChallenges } from '../../../db/schema/identity/user-login-challenges.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  LoginChallengeStore,
  NewLoginChallenge,
} from '../../application/identity/ports.ts';

@injectable()
export class D1LoginChallengeStore implements LoginChallengeStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async insert(challenge: NewLoginChallenge): Promise<void> {
    await this.db.insert(userLoginChallenges).values(challenge);
  }

  async findValid(
    tokenHash: string,
    now: Date,
  ): Promise<{ readonly id: string; readonly userId: string } | undefined> {
    const [row] = await this.db
      .select({
        id: userLoginChallenges.id,
        userId: userLoginChallenges.userId,
      })
      .from(userLoginChallenges)
      .where(
        and(
          eq(userLoginChallenges.tokenHash, tokenHash),
          gt(userLoginChallenges.expiresAt, now),
        ),
      );
    return row;
  }

  async delete(id: string): Promise<void> {
    await this.db
      .delete(userLoginChallenges)
      .where(eq(userLoginChallenges.id, id));
  }

  async deleteExpired(now: Date): Promise<number> {
    const result = await this.db
      .delete(userLoginChallenges)
      .where(lte(userLoginChallenges.expiresAt, now));
    return result.meta.changes;
  }
}
