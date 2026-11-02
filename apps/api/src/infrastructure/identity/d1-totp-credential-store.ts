import {
  and,
  eq,
  exists,
  gt,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { userRecoveryCodes } from '../../../db/schema/identity/user-recovery-codes.ts';
import { userTotpCredentials } from '../../../db/schema/identity/user-totp-credentials.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  TotpCredential,
  TotpCredentialStore,
} from '../../application/identity/ports.ts';
import { recoveryCodeInsertsWhen } from './d1-recovery-code-store.ts';

const TOTP_CREDENTIAL_COLUMNS = {
  sealedSecret: userTotpCredentials.sealedSecret,
  enabledAt: userTotpCredentials.enabledAt,
  pendingExpiresAt: userTotpCredentials.pendingExpiresAt,
  lastUsedStep: userTotpCredentials.lastUsedStep,
};

// 期限ちょうどを期限切れとするため、期限が現在より後の保留だけを有効な保留とする
function validPendingAt(at: Date) {
  return and(
    isNull(userTotpCredentials.enabledAt),
    gt(userTotpCredentials.pendingExpiresAt, at),
  );
}

@injectable()
export class D1TotpCredentialStore implements TotpCredentialStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async find(userId: string): Promise<TotpCredential | undefined> {
    const [row] = await this.db
      .select(TOTP_CREDENTIAL_COLUMNS)
      .from(userTotpCredentials)
      .where(eq(userTotpCredentials.userId, userId));
    return row;
  }

  async savePending(
    userId: string,
    sealedSecret: string,
    expiresAt: Date,
  ): Promise<'saved' | 'already-enabled'> {
    const now = new Date();
    const rows = await this.db
      .insert(userTotpCredentials)
      .values({
        userId,
        sealedSecret,
        pendingExpiresAt: expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userTotpCredentials.userId,
        set: {
          sealedSecret,
          pendingExpiresAt: expiresAt,
          lastUsedStep: null,
          updatedAt: now,
        },
        setWhere: isNull(userTotpCredentials.enabledAt),
      })
      .returning({ id: userTotpCredentials.id });
    return rows.length > 0 ? 'saved' : 'already-enabled';
  }

  // 保留の判定が有効化の前の状態で行われるよう、リカバリコードの書き込みを資格情報の更新より前に置く
  async enable(
    userId: string,
    step: number,
    at: Date,
    recoveryHashes: readonly string[],
  ): Promise<'enabled' | 'not-pending'> {
    const pendingOfUser = this.db
      .select({ one: sql`1` })
      .from(userTotpCredentials)
      .where(and(eq(userTotpCredentials.userId, userId), validPendingAt(at)));
    const results = await this.db.batch([
      this.db
        .delete(userRecoveryCodes)
        .where(
          and(eq(userRecoveryCodes.userId, userId), exists(pendingOfUser)),
        ),
      ...recoveryCodeInsertsWhen(
        this.db,
        userId,
        recoveryHashes,
        at,
        validPendingAt(at),
      ),
      this.db
        .update(userTotpCredentials)
        .set({
          enabledAt: at,
          pendingExpiresAt: null,
          lastUsedStep: step,
          updatedAt: at,
        })
        .where(and(eq(userTotpCredentials.userId, userId), validPendingAt(at))),
    ]);
    return (results.at(-1)?.meta.changes ?? 0) > 0 ? 'enabled' : 'not-pending';
  }

  async advanceStep(userId: string, step: number): Promise<boolean> {
    const result = await this.db
      .update(userTotpCredentials)
      .set({ lastUsedStep: step, updatedAt: new Date() })
      .where(
        and(
          eq(userTotpCredentials.userId, userId),
          isNotNull(userTotpCredentials.enabledAt),
          or(
            isNull(userTotpCredentials.lastUsedStep),
            lt(userTotpCredentials.lastUsedStep, step),
          ),
        ),
      );
    return result.meta.changes > 0;
  }

  async disable(userId: string): Promise<void> {
    await this.db.batch([
      this.db
        .delete(userRecoveryCodes)
        .where(eq(userRecoveryCodes.userId, userId)),
      this.db
        .delete(userTotpCredentials)
        .where(eq(userTotpCredentials.userId, userId)),
    ]);
  }

  async deleteExpiredPending(now: Date): Promise<number> {
    const result = await this.db
      .delete(userTotpCredentials)
      .where(
        and(
          isNull(userTotpCredentials.enabledAt),
          lte(userTotpCredentials.pendingExpiresAt, now),
        ),
      );
    return result.meta.changes;
  }
}
