import { and, eq, inArray, lte, or } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { adminSessions } from '../../../db/schema/admin/admin-sessions.ts';
import { admins } from '../../../db/schema/admin/admins.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  AdminSessionStore,
  NewAdminSessionRecord,
  StoredAdminSession,
} from '../../application/admin/ports.ts';
import type { AdminSnapshot } from '../../domain/admin/admin-account.ts';
import type { SessionPolicy } from '../../domain/auth/session-policy.ts';

const MS_PER_SECOND = 1000;

const SESSION_COLUMNS = {
  id: adminSessions.id,
  adminId: adminSessions.adminId,
  tokenHash: adminSessions.tokenHash,
  userAgent: adminSessions.userAgent,
  createdAt: adminSessions.createdAt,
  lastUsedAt: adminSessions.lastUsedAt,
  absoluteExpiresAt: adminSessions.absoluteExpiresAt,
};

@injectable()
export class D1AdminSessionStore implements AdminSessionStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async insert(session: NewAdminSessionRecord): Promise<void> {
    await this.db
      .insert(adminSessions)
      .values({ ...session, updatedAt: session.createdAt });
  }

  async findByTokenHash(
    tokenHash: string,
  ): Promise<
    (StoredAdminSession & { readonly admin: AdminSnapshot }) | undefined
  > {
    const [row] = await this.db
      .select({
        ...SESSION_COLUMNS,
        admin: {
          id: admins.id,
          role: admins.role,
          status: admins.status,
          invitationExpiresAt: admins.invitationExpiresAt,
        },
      })
      .from(adminSessions)
      .innerJoin(admins, eq(admins.id, adminSessions.adminId))
      .where(eq(adminSessions.tokenHash, tokenHash));
    return row;
  }

  async touch(sessionId: string, at: Date): Promise<void> {
    await this.db
      .update(adminSessions)
      .set({ lastUsedAt: at, updatedAt: at })
      .where(eq(adminSessions.id, sessionId));
  }

  async deleteOne(adminId: string, sessionId: string): Promise<boolean> {
    const result = await this.db
      .delete(adminSessions)
      .where(
        and(
          eq(adminSessions.id, sessionId),
          eq(adminSessions.adminId, adminId),
        ),
      );
    return result.meta.changes > 0;
  }

  // 期限ちょうどを期限切れとするevaluateSessionと同じ境界で削除する
  async deleteExpired(
    now: Date,
    policy: SessionPolicy,
    limit: number,
  ): Promise<number> {
    const idleBoundary = new Date(
      now.getTime() - policy.idleSeconds * MS_PER_SECOND,
    );
    const expiredIds = this.db
      .select({ id: adminSessions.id })
      .from(adminSessions)
      .where(
        or(
          lte(adminSessions.lastUsedAt, idleBoundary),
          lte(adminSessions.absoluteExpiresAt, now),
        ),
      )
      .limit(limit);
    const result = await this.db
      .delete(adminSessions)
      .where(inArray(adminSessions.id, expiredIds));
    return result.meta.changes;
  }
}
