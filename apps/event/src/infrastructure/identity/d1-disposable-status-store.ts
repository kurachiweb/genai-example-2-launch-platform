import { and, eq, isNotNull, isNull, or } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { DisposableEmailStatus } from '../../../lib/core/identity/disposable-email.ts';
import type {
  DisposableRecheckSubject,
  DisposableStatusStore,
} from '../../application/identity/ports.ts';

@injectable()
export class D1DisposableStatusStore implements DisposableStatusStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async findSubject(
    userId: string,
  ): Promise<DisposableRecheckSubject | undefined> {
    const [row] = await this.db
      .select({
        email: users.email,
        deletedAt: users.deletedAt,
        emailVerifiedAt: users.emailVerifiedAt,
        status: users.disposableEmailStatus,
      })
      .from(users)
      .where(eq(users.id, userId));
    if (row === undefined) {
      return undefined;
    }
    return {
      email: row.email,
      withdrawn: row.deletedAt !== null,
      emailVerified: row.emailVerifiedAt !== null,
      status: row.status,
    };
  }

  // 判定サービスの応答を待つ間に、メールアドレスの変更・退会・APIサーバーでの判定の確定が起き得るため、読み取った時の条件を満たす場合だけ書き込む
  async saveRecheckResult(
    userId: string,
    email: string,
    status: DisposableEmailStatus,
    at: Date,
  ): Promise<void> {
    await this.db
      .update(users)
      .set({
        disposableEmailStatus: status,
        disposableEmailCheckedAt: at,
        updatedAt: at,
      })
      .where(
        and(
          eq(users.id, userId),
          eq(users.email, email),
          isNull(users.deletedAt),
          isNotNull(users.emailVerifiedAt),
          or(
            isNull(users.disposableEmailStatus),
            eq(users.disposableEmailStatus, 'undetermined'),
          ),
        ),
      );
  }
}
