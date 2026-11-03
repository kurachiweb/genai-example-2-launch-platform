import { and, count, eq, isNotNull } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { userRecoveryCodes } from '../../../db/schema/identity/user-recovery-codes.ts';
import { userTotpCredentials } from '../../../db/schema/identity/user-totp-credentials.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { RecoveryCodeStore } from '../../application/identity/ports.ts';
import {
  recoveryCodeDeletionWhen,
  recoveryCodeInsertsWhen,
  sessionDeletionWhen,
} from './totp-credential-conditional-writes.ts';

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

  // 最後の資格情報の更新日時の更新が、有効な設定があったかの判定を兼ねる
  async replaceAllRevokingSessions(
    userId: string,
    hashes: readonly string[],
  ): Promise<'replaced' | 'not-enabled'> {
    const at = new Date();
    const enabled = isNotNull(userTotpCredentials.enabledAt);
    const results = await this.db.batch([
      recoveryCodeDeletionWhen(this.db, userId, enabled),
      ...recoveryCodeInsertsWhen(this.db, userId, hashes, at, enabled),
      sessionDeletionWhen(this.db, userId, enabled),
      this.db
        .update(userTotpCredentials)
        .set({ updatedAt: at })
        .where(and(eq(userTotpCredentials.userId, userId), enabled)),
    ]);
    return (results.at(-1)?.meta.changes ?? 0) > 0 ? 'replaced' : 'not-enabled';
  }
}
