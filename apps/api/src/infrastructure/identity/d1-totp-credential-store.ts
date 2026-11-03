import { and, eq, gt, isNotNull, isNull, lt, lte, or } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { userTotpCredentials } from '../../../db/schema/identity/user-totp-credentials.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  TotpCredential,
  TotpCredentialStore,
} from '../../application/identity/ports.ts';
import {
  recoveryCodeDeletionWhen,
  recoveryCodeInsertsWhen,
  sessionDeletionWhen,
} from './totp-credential-conditional-writes.ts';

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

// 照合の後に設定が始め直されると保留の秘密鍵が入れ替わるため、照合に使った秘密鍵の保留だけを有効にする
function verifiedPendingAt(at: Date, sealedSecret: string) {
  return and(
    validPendingAt(at),
    eq(userTotpCredentials.sealedSecret, sealedSecret),
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

  // 保留の判定が有効化の前の状態で行われるよう、リカバリコードとセッションの書き込みを資格情報の更新より前に置く
  async enableRevokingSessions(
    userId: string,
    sealedSecret: string,
    step: number,
    at: Date,
    recoveryHashes: readonly string[],
  ): Promise<'enabled' | 'not-pending'> {
    const pending = verifiedPendingAt(at, sealedSecret);
    const results = await this.db.batch([
      recoveryCodeDeletionWhen(this.db, userId, pending),
      ...recoveryCodeInsertsWhen(this.db, userId, recoveryHashes, at, pending),
      sessionDeletionWhen(this.db, userId, pending),
      this.db
        .update(userTotpCredentials)
        .set({
          enabledAt: at,
          pendingExpiresAt: null,
          lastUsedStep: step,
          updatedAt: at,
        })
        .where(and(eq(userTotpCredentials.userId, userId), pending)),
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

  // 有効かの判定が削除の前の状態で行われるよう、リカバリコードとセッションの削除を資格情報の削除より前に置く
  async disableRevokingSessions(
    userId: string,
  ): Promise<'disabled' | 'not-enabled'> {
    const enabled = isNotNull(userTotpCredentials.enabledAt);
    const results = await this.db.batch([
      recoveryCodeDeletionWhen(this.db, userId, enabled),
      sessionDeletionWhen(this.db, userId, enabled),
      this.db
        .delete(userTotpCredentials)
        .where(and(eq(userTotpCredentials.userId, userId), enabled)),
    ]);
    return (results.at(-1)?.meta.changes ?? 0) > 0 ? 'disabled' : 'not-enabled';
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
