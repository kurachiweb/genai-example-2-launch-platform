import { and, eq, isNull } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { userTotpCredentials } from '../../../db/schema/identity/user-totp-credentials.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  AccountExport,
  AccountExportRecord,
} from '../../core/identity/ports.ts';

@injectable()
export class D1AccountExport implements AccountExport {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  // 停止中の利用者も出力の対象のため状態は見ない。D1の失敗は呼び出し元の再試行に任せるため例外のまま投げる
  async find(userId: string): Promise<AccountExportRecord | undefined> {
    const [row] = await this.db
      .select({
        pseudonymousId: users.pseudonymousId,
        email: users.email,
        emailVerifiedAt: users.emailVerifiedAt,
        registeredAt: users.createdAt,
        totpEnabledAt: userTotpCredentials.enabledAt,
      })
      .from(users)
      .leftJoin(userTotpCredentials, eq(userTotpCredentials.userId, users.id))
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    if (row === undefined) {
      return undefined;
    }
    return {
      userId,
      pseudonymousId: row.pseudonymousId,
      email: row.email,
      emailVerifiedAt: row.emailVerifiedAt,
      registeredAt: row.registeredAt,
      mfaEnabled: row.totpEnabledAt !== null,
    };
  }
}
