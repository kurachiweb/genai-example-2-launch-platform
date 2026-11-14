import { and, count, eq, isNotNull } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { adminRecoveryCodes } from '../../../db/schema/admin/admin-recovery-codes.ts';
import { adminTotpCredentials } from '../../../db/schema/admin/admin-totp-credentials.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { AdminRecoveryCodeStore } from '../../application/admin/ports.ts';
import {
  adminRecoveryCodeDeletionWhen,
  adminRecoveryCodeInsertsWhen,
  adminSessionDeletionWhen,
} from './admin-totp-conditional-writes.ts';

@injectable()
export class D1AdminRecoveryCodeStore implements AdminRecoveryCodeStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async consume(adminId: string, codeHash: string): Promise<boolean> {
    const result = await this.db
      .delete(adminRecoveryCodes)
      .where(
        and(
          eq(adminRecoveryCodes.adminId, adminId),
          eq(adminRecoveryCodes.codeHash, codeHash),
        ),
      );
    return result.meta.changes > 0;
  }

  async count(adminId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(adminRecoveryCodes)
      .where(eq(adminRecoveryCodes.adminId, adminId));
    return row?.value ?? 0;
  }

  // 最後の資格情報の更新日時の更新が、有効な設定があったかの判定を兼ねる
  async replaceAllRevokingSessions(
    adminId: string,
    hashes: readonly string[],
  ): Promise<'replaced' | 'not-enabled'> {
    const at = new Date();
    const enabled = isNotNull(adminTotpCredentials.enabledAt);
    const results = await this.db.batch([
      adminRecoveryCodeDeletionWhen(this.db, adminId, enabled),
      ...adminRecoveryCodeInsertsWhen(this.db, adminId, hashes, at, enabled),
      adminSessionDeletionWhen(this.db, adminId, enabled),
      this.db
        .update(adminTotpCredentials)
        .set({ updatedAt: at })
        .where(and(eq(adminTotpCredentials.adminId, adminId), enabled)),
    ]);
    return (results.at(-1)?.meta.changes ?? 0) > 0 ? 'replaced' : 'not-enabled';
  }
}
