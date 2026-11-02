import { and, asc, desc, eq, lte, ne, or } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { userSessions } from '../../../db/schema/identity/user-sessions.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  NewSessionRecord,
  StoredSession,
  UserSessionStore,
} from '../../application/identity/ports.ts';
import type { SessionPolicy } from '../../domain/auth/session-policy.ts';
import type { UserAccountSnapshot } from '../../domain/identity/user-account.ts';

const MS_PER_SECOND = 1000;

const SESSION_COLUMNS = {
  id: userSessions.id,
  userId: userSessions.userId,
  tokenHash: userSessions.tokenHash,
  userAgent: userSessions.userAgent,
  createdAt: userSessions.createdAt,
  lastUsedAt: userSessions.lastUsedAt,
  absoluteExpiresAt: userSessions.absoluteExpiresAt,
};

@injectable()
export class D1UserSessionStore implements UserSessionStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async insert(session: NewSessionRecord): Promise<void> {
    await this.db
      .insert(userSessions)
      .values({ ...session, updatedAt: session.createdAt });
  }

  async findByTokenHash(
    tokenHash: string,
  ): Promise<
    (StoredSession & { readonly user: UserAccountSnapshot }) | undefined
  > {
    const [row] = await this.db
      .select({
        ...SESSION_COLUMNS,
        user: {
          id: users.id,
          status: users.status,
          emailVerifiedAt: users.emailVerifiedAt,
          deletedAt: users.deletedAt,
        },
      })
      .from(userSessions)
      .innerJoin(users, eq(users.id, userSessions.userId))
      .where(eq(userSessions.tokenHash, tokenHash));
    return row;
  }

  async touch(sessionId: string, at: Date): Promise<void> {
    await this.db
      .update(userSessions)
      .set({ lastUsedAt: at, updatedAt: at })
      .where(eq(userSessions.id, sessionId));
  }

  async listByUser(userId: string): Promise<readonly StoredSession[]> {
    return this.db
      .select(SESSION_COLUMNS)
      .from(userSessions)
      .where(eq(userSessions.userId, userId))
      .orderBy(desc(userSessions.lastUsedAt), asc(userSessions.id));
  }

  async deleteOne(userId: string, sessionId: string): Promise<boolean> {
    const result = await this.db
      .delete(userSessions)
      .where(
        and(eq(userSessions.id, sessionId), eq(userSessions.userId, userId)),
      );
    return result.meta.changes > 0;
  }

  async deleteOthers(userId: string, keepSessionId: string): Promise<number> {
    const result = await this.db
      .delete(userSessions)
      .where(
        and(
          eq(userSessions.userId, userId),
          ne(userSessions.id, keepSessionId),
        ),
      );
    return result.meta.changes;
  }

  async deleteAllOfUser(userId: string): Promise<void> {
    await this.db.delete(userSessions).where(eq(userSessions.userId, userId));
  }

  // 期限ちょうどを期限切れとするevaluateSessionと同じ境界で削除する
  async deleteExpired(now: Date, policy: SessionPolicy): Promise<number> {
    const idleBoundary = new Date(
      now.getTime() - policy.idleSeconds * MS_PER_SECOND,
    );
    const result = await this.db
      .delete(userSessions)
      .where(
        or(
          lte(userSessions.lastUsedAt, idleBoundary),
          lte(userSessions.absoluteExpiresAt, now),
        ),
      );
    return result.meta.changes;
  }
}
