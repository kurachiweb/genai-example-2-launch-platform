import { and, count, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import { inject, injectable } from 'inversify';
import { ulid } from 'ulid';

import type { Database } from '../../../db/client.ts';
import { userRecoveryCodes } from '../../../db/schema/identity/user-recovery-codes.ts';
import { userTotpCredentials } from '../../../db/schema/identity/user-totp-credentials.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { RecoveryCodeStore } from '../../application/identity/ports.ts';

// 同じ一括の書き込みの中で資格情報の状態が条件を満たすときだけ追加されるよう、資格情報の行からの選択で挿入する
export function recoveryCodeInsertsWhen(
  db: Database,
  userId: string,
  hashes: readonly string[],
  at: Date,
  credentialCondition: SQL | undefined,
) {
  return hashes.map((codeHash) =>
    db.insert(userRecoveryCodes).select(
      db
        .select({
          id: sql<string>`${ulid()}`.as('id'),
          userId: userTotpCredentials.userId,
          codeHash: sql<string>`${codeHash}`.as('code_hash'),
          createdAt: sql<number>`${at.getTime()}`.as('created_at'),
          updatedAt: sql<number>`${at.getTime()}`.as('updated_at'),
        })
        .from(userTotpCredentials)
        .where(
          and(eq(userTotpCredentials.userId, userId), credentialCondition),
        ),
    ),
  );
}

@injectable()
export class D1RecoveryCodeStore implements RecoveryCodeStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async consume(userId: string, codeHash: string): Promise<boolean> {
    const result = await this.db
      .delete(userRecoveryCodes)
      .where(
        and(
          eq(userRecoveryCodes.userId, userId),
          eq(userRecoveryCodes.codeHash, codeHash),
        ),
      );
    return result.meta.changes > 0;
  }

  async count(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(userRecoveryCodes)
      .where(eq(userRecoveryCodes.userId, userId));
    return row?.value ?? 0;
  }

  async replaceAll(userId: string, hashes: readonly string[]): Promise<void> {
    await this.db.batch([
      this.db
        .delete(userRecoveryCodes)
        .where(eq(userRecoveryCodes.userId, userId)),
      ...recoveryCodeInsertsWhen(
        this.db,
        userId,
        hashes,
        new Date(),
        isNotNull(userTotpCredentials.enabledAt),
      ),
    ]);
  }
}
