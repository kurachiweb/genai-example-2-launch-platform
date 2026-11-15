import { and, eq, isNull } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  UserContact,
  UserContactDirectory,
} from '../../core/identity/ports.ts';

@injectable()
export class D1UserContactDirectory implements UserContactDirectory {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  // 停止中の利用者にも通知を届けるため状態は見ない。D1の失敗は呼び出し元の再試行に任せるため例外のまま投げる
  async findContact(userId: string): Promise<UserContact | undefined> {
    const [row] = await this.db
      .select({
        email: users.email,
        nickname: users.nickname,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    if (row === undefined) {
      return undefined;
    }
    return {
      userId,
      email: row.email,
      nickname: row.nickname,
      emailVerified: row.emailVerifiedAt !== null,
    };
  }
}
