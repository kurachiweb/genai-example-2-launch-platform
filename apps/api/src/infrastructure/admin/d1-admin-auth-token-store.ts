import { and, eq, gt, inArray, lte } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { adminAuthTokens } from '../../../db/schema/admin/admin-auth-tokens.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  AdminAuthTokenStore,
  ConsumedAdminAuthToken,
  NewAdminAuthToken,
} from '../../application/admin/ports.ts';
import type { AdminAuthTokenPurpose } from '../../domain/admin/admin-auth-token-purpose.ts';

const CONSUMED_TOKEN_COLUMNS = {
  adminId: adminAuthTokens.adminId,
  newEmail: adminAuthTokens.newEmail,
};

@injectable()
export class D1AdminAuthTokenStore implements AdminAuthTokenStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async replace(token: NewAdminAuthToken): Promise<void> {
    await this.db.batch([
      this.db
        .delete(adminAuthTokens)
        .where(
          and(
            eq(adminAuthTokens.adminId, token.adminId),
            eq(adminAuthTokens.purpose, token.purpose),
          ),
        ),
      this.db.insert(adminAuthTokens).values({
        adminId: token.adminId,
        purpose: token.purpose,
        tokenHash: token.tokenHash,
        expiresAt: token.expiresAt,
        newEmail: token.newEmail ?? null,
      }),
    ]);
  }

  async findValid(
    purpose: AdminAuthTokenPurpose,
    tokenHash: string,
    now: Date,
  ): Promise<ConsumedAdminAuthToken | undefined> {
    const [row] = await this.db
      .select(CONSUMED_TOKEN_COLUMNS)
      .from(adminAuthTokens)
      .where(this.validTokenOf(purpose, tokenHash, now));
    return row;
  }

  async consume(
    purpose: AdminAuthTokenPurpose,
    tokenHash: string,
    now: Date,
  ): Promise<ConsumedAdminAuthToken | undefined> {
    const [row] = await this.db
      .delete(adminAuthTokens)
      .where(this.validTokenOf(purpose, tokenHash, now))
      .returning(CONSUMED_TOKEN_COLUMNS);
    return row;
  }

  async deleteExpired(now: Date, limit: number): Promise<number> {
    const expiredIds = this.db
      .select({ id: adminAuthTokens.id })
      .from(adminAuthTokens)
      .where(lte(adminAuthTokens.expiresAt, now))
      .limit(limit);
    const result = await this.db
      .delete(adminAuthTokens)
      .where(inArray(adminAuthTokens.id, expiredIds));
    return result.meta.changes;
  }

  // 期限ちょうどを期限切れとするため、期限が現在より後のトークンだけを有効とする
  private validTokenOf(
    purpose: AdminAuthTokenPurpose,
    tokenHash: string,
    now: Date,
  ) {
    return and(
      eq(adminAuthTokens.tokenHash, tokenHash),
      eq(adminAuthTokens.purpose, purpose),
      gt(adminAuthTokens.expiresAt, now),
    );
  }
}
