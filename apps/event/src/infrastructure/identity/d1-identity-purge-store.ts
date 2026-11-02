import { eq, inArray } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { userAuthTokens } from '../../../db/schema/identity/user-auth-tokens.ts';
import { userLifecycleEvents } from '../../../db/schema/identity/user-lifecycle-events.ts';
import { userLifecycleHandlerRuns } from '../../../db/schema/identity/user-lifecycle-handler-runs.ts';
import { userLoginChallenges } from '../../../db/schema/identity/user-login-challenges.ts';
import { userRecoveryCodes } from '../../../db/schema/identity/user-recovery-codes.ts';
import { userSessions } from '../../../db/schema/identity/user-sessions.ts';
import { userTotpCredentials } from '../../../db/schema/identity/user-totp-credentials.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { IdentityPurgeStore } from '../../application/identity/ports.ts';

@injectable()
export class D1IdentityPurgeStore implements IdentityPurgeStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  // 外部キーにON DELETEの動作を指定していないため子の行から順に消す。他specの行が利用者を参照していれば最後の文が失敗し、一括の書き込み全体が取り消される
  async purge(userId: string): Promise<void> {
    const eventIdsOfUser = this.db
      .select({ id: userLifecycleEvents.id })
      .from(userLifecycleEvents)
      .where(eq(userLifecycleEvents.userId, userId));
    await this.db.batch([
      this.db
        .delete(userRecoveryCodes)
        .where(eq(userRecoveryCodes.userId, userId)),
      this.db
        .delete(userTotpCredentials)
        .where(eq(userTotpCredentials.userId, userId)),
      this.db
        .delete(userLoginChallenges)
        .where(eq(userLoginChallenges.userId, userId)),
      this.db.delete(userAuthTokens).where(eq(userAuthTokens.userId, userId)),
      this.db.delete(userSessions).where(eq(userSessions.userId, userId)),
      this.db
        .delete(userLifecycleHandlerRuns)
        .where(inArray(userLifecycleHandlerRuns.eventId, eventIdsOfUser)),
      this.db
        .delete(userLifecycleEvents)
        .where(eq(userLifecycleEvents.userId, userId)),
      this.db.delete(users).where(eq(users.id, userId)),
    ]);
  }
}
