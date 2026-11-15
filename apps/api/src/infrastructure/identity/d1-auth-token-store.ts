import { and, eq, gt, lte } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { userAuthTokens } from '../../../db/schema/identity/user-auth-tokens.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  AuthTokenStore,
  ConsumedAuthToken,
  NewAuthToken,
} from '../../application/identity/ports.ts';
import type { AuthTokenPurpose } from '../../domain/identity/auth-token-purpose.ts';

const CONSUMED_TOKEN_COLUMNS = {
  userId: userAuthTokens.userId,
  newEmail: userAuthTokens.newEmail,
  pendingPasswordHash: userAuthTokens.pendingPasswordHash,
};

@injectable()
export class D1AuthTokenStore implements AuthTokenStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async replace(token: NewAuthToken): Promise<void> {
    await this.db.batch([
      this.db
        .delete(userAuthTokens)
        .where(
          and(
            eq(userAuthTokens.userId, token.userId),
            eq(userAuthTokens.purpose, token.purpose),
          ),
        ),
      this.db.insert(userAuthTokens).values({
        userId: token.userId,
        purpose: token.purpose,
        tokenHash: token.tokenHash,
        expiresAt: token.expiresAt,
        newEmail: token.newEmail ?? null,
        pendingPasswordHash: token.pendingPasswordHash ?? null,
      }),
    ]);
  }

  async findValid(
    purpose: AuthTokenPurpose,
    tokenHash: string,
    now: Date,
  ): Promise<ConsumedAuthToken | undefined> {
    const [row] = await this.db
      .select(CONSUMED_TOKEN_COLUMNS)
      .from(userAuthTokens)
      .where(this.validTokenOf(purpose, tokenHash, now));
    return row;
  }

  async consume(
    purpose: AuthTokenPurpose,
    tokenHash: string,
    now: Date,
  ): Promise<ConsumedAuthToken | undefined> {
    const [row] = await this.db
      .delete(userAuthTokens)
      .where(this.validTokenOf(purpose, tokenHash, now))
      .returning(CONSUMED_TOKEN_COLUMNS);
    return row;
  }

  async deleteExpired(now: Date): Promise<number> {
    const result = await this.db
      .delete(userAuthTokens)
      .where(lte(userAuthTokens.expiresAt, now));
    return result.meta.changes;
  }

  private validTokenOf(
    purpose: AuthTokenPurpose,
    tokenHash: string,
    now: Date,
  ) {
    return and(
      eq(userAuthTokens.tokenHash, tokenHash),
      eq(userAuthTokens.purpose, purpose),
      gt(userAuthTokens.expiresAt, now),
    );
  }
}
