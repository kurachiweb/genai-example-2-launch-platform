import {
  and,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { adminTotpCredentials } from '../../../db/schema/admin/admin-totp-credentials.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  AdminTotpCredential,
  AdminTotpCredentialStore,
  AdminTotpPendingCommit,
} from '../../application/admin/ports.ts';
import {
  adminRecoveryCodeDeletionWhen,
  adminRecoveryCodeInsertsWhen,
  adminSessionDeletionWhen,
} from './admin-totp-conditional-writes.ts';

const TOTP_CREDENTIAL_COLUMNS = {
  sealedSecret: adminTotpCredentials.sealedSecret,
  enabledAt: adminTotpCredentials.enabledAt,
  lastUsedStep: adminTotpCredentials.lastUsedStep,
  pendingSealedSecret: adminTotpCredentials.pendingSealedSecret,
  pendingExpiresAt: adminTotpCredentials.pendingExpiresAt,
};

// 照合の後に設定が始め直されると保留の秘密鍵が入れ替わるため、照合に使った秘密鍵の保留だけを入れ替えの対象にする。
// 期限ちょうどを期限切れとするため、期限が入れ替えの時刻より後の保留だけを有効とする
function verifiedPendingOfEnabled(at: Date, pendingSealedSecret: string) {
  return and(
    isNotNull(adminTotpCredentials.enabledAt),
    eq(adminTotpCredentials.pendingSealedSecret, pendingSealedSecret),
    gt(adminTotpCredentials.pendingExpiresAt, at),
  );
}

@injectable()
export class D1AdminTotpCredentialStore implements AdminTotpCredentialStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async find(adminId: string): Promise<AdminTotpCredential | undefined> {
    const [row] = await this.db
      .select(TOTP_CREDENTIAL_COLUMNS)
      .from(adminTotpCredentials)
      .where(eq(adminTotpCredentials.adminId, adminId));
    return row;
  }

  async savePending(
    adminId: string,
    sealedSecret: string,
    expiresAt: Date,
  ): Promise<void> {
    const now = new Date();
    await this.db
      .insert(adminTotpCredentials)
      .values({
        adminId,
        pendingSealedSecret: sealedSecret,
        pendingExpiresAt: expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: adminTotpCredentials.adminId,
        set: {
          pendingSealedSecret: sealedSecret,
          pendingExpiresAt: expiresAt,
          updatedAt: now,
        },
      });
  }

  // 保留の判定が入れ替えの前の状態で行われるよう、リカバリコードとセッションの書き込みを資格情報の更新より前に置く
  async commitPendingRevokingSessions(
    adminId: string,
    commit: AdminTotpPendingCommit,
  ): Promise<'committed' | 'not-pending'> {
    const { at, step, pendingSealedSecret, recoveryHashes } = commit;
    const pending = verifiedPendingOfEnabled(at, pendingSealedSecret);
    const results = await this.db.batch([
      adminRecoveryCodeDeletionWhen(this.db, adminId, pending),
      ...adminRecoveryCodeInsertsWhen(
        this.db,
        adminId,
        recoveryHashes,
        at,
        pending,
      ),
      adminSessionDeletionWhen(this.db, adminId, pending),
      this.db
        .update(adminTotpCredentials)
        .set({
          sealedSecret: sql`${adminTotpCredentials.pendingSealedSecret}`,
          lastUsedStep: step,
          pendingSealedSecret: null,
          pendingExpiresAt: null,
          updatedAt: at,
        })
        .where(and(eq(adminTotpCredentials.adminId, adminId), pending)),
    ]);
    return (results.at(-1)?.meta.changes ?? 0) > 0
      ? 'committed'
      : 'not-pending';
  }

  async advanceStep(adminId: string, step: number): Promise<boolean> {
    const result = await this.db
      .update(adminTotpCredentials)
      .set({ lastUsedStep: step, updatedAt: new Date() })
      .where(
        and(
          eq(adminTotpCredentials.adminId, adminId),
          isNotNull(adminTotpCredentials.enabledAt),
          or(
            isNull(adminTotpCredentials.lastUsedStep),
            lt(adminTotpCredentials.lastUsedStep, step),
          ),
        ),
      );
    return result.meta.changes > 0;
  }

  // 有効な設定を持つ行も保留だけを持つため、行を消さずに保留の列だけを空にする
  async clearExpiredPending(now: Date, limit: number): Promise<number> {
    const expiredIds = this.db
      .select({ id: adminTotpCredentials.id })
      .from(adminTotpCredentials)
      .where(lte(adminTotpCredentials.pendingExpiresAt, now))
      .limit(limit);
    const result = await this.db
      .update(adminTotpCredentials)
      .set({
        pendingSealedSecret: null,
        pendingExpiresAt: null,
        updatedAt: now,
      })
      .where(inArray(adminTotpCredentials.id, expiredIds));
    return result.meta.changes;
  }
}
