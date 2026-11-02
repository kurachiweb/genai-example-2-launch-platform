import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  sql,
} from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { userAuthTokens } from '../../../db/schema/identity/user-auth-tokens.ts';
import { userSessions } from '../../../db/schema/identity/user-sessions.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { DisposableEmailStatus } from '../../../lib/core/identity/disposable-email.ts';
import type {
  NewAuthToken,
  NewSessionRecord,
  NewUserRecord,
  UserAccountStore,
  UserRecord,
} from '../../application/identity/ports.ts';
import {
  AUTH_TOKEN_PURPOSES_REVOKED_ON_COMPLETION,
  type CompletingAuthTokenPurpose,
} from '../../domain/identity/auth-token-purpose.ts';

const USER_RECORD_COLUMNS = {
  id: users.id,
  status: users.status,
  emailVerifiedAt: users.emailVerifiedAt,
  deletedAt: users.deletedAt,
  pseudonymousId: users.pseudonymousId,
  email: users.email,
  passwordHash: users.passwordHash,
  nickname: users.nickname,
  handle: users.handle,
  disposableEmailStatus: users.disposableEmailStatus,
  termsAgreedAt: users.termsAgreedAt,
  lifecycleVersion: users.lifecycleVersion,
};

const EMAIL_COLUMN = 'users.email';

const HANDLE_COLUMN = 'users.handle';

const UNIQUE_VIOLATION_PATTERN = /UNIQUE constraint failed: ([^:]+)/;

// 一括の書き込みの失敗はD1のエラーがcauseにSQLiteのエラーを持ち、文の組み立ての失敗はDrizzleQueryErrorが包むため、原因をたどって違反した列を集める。
// 文言は列名の後に`: SQLITE_CONSTRAINT (...)`が続くため、`:`の手前までを列名とする
function uniqueViolationColumns(error: unknown): ReadonlySet<string> {
  for (let current = error; current instanceof Error; current = current.cause) {
    const columns = UNIQUE_VIOLATION_PATTERN.exec(current.message)?.[1];
    if (columns !== undefined) {
      return new Set(columns.split(',').map((column) => column.trim()));
    }
  }
  return new Set();
}

@injectable()
export class D1UserAccountStore implements UserAccountStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async findById(userId: string): Promise<UserRecord | undefined> {
    const [row] = await this.db
      .select(USER_RECORD_COLUMNS)
      .from(users)
      .where(eq(users.id, userId));
    return row;
  }

  async findNotWithdrawnByEmail(
    email: string,
  ): Promise<UserRecord | undefined> {
    const [row] = await this.db
      .select(USER_RECORD_COLUMNS)
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)));
    return row;
  }

  async isEmailInUse(email: string, exceptUserId?: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.email, email),
          isNull(users.deletedAt),
          exceptUserId === undefined ? undefined : ne(users.id, exceptUserId),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async createWithVerification(
    user: NewUserRecord,
    token: NewAuthToken,
    session: NewSessionRecord,
  ): Promise<'created' | 'email-in-use' | 'handle-in-use'> {
    const at = session.createdAt;
    try {
      await this.db.batch([
        this.db.insert(users).values({ ...user, createdAt: at, updatedAt: at }),
        this.db.insert(userAuthTokens).values({
          userId: token.userId,
          purpose: token.purpose,
          tokenHash: token.tokenHash,
          expiresAt: token.expiresAt,
          newEmail: token.newEmail ?? null,
          pendingPasswordHash: token.pendingPasswordHash ?? null,
          createdAt: at,
          updatedAt: at,
        }),
        this.db.insert(userSessions).values({ ...session, updatedAt: at }),
      ]);
      return 'created';
    } catch (error) {
      const columns = uniqueViolationColumns(error);
      if (columns.has(EMAIL_COLUMN)) {
        return 'email-in-use';
      }
      if (columns.has(HANDLE_COLUMN)) {
        return 'handle-in-use';
      }
      throw error;
    }
  }

  async markEmailVerified(userId: string, at: Date): Promise<void> {
    await this.db
      .update(users)
      .set({ emailVerifiedAt: at, updatedAt: at })
      .where(eq(users.id, userId));
  }

  async saveDisposableStatus(
    userId: string,
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
      .where(eq(users.id, userId));
  }

  async applyPasswordReset(
    userId: string,
    passwordHash: string,
    at: Date,
  ): Promise<void> {
    await this.db.batch([
      this.db
        .update(users)
        .set({
          passwordHash,
          emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, ${at.getTime()})`,
          updatedAt: at,
        })
        .where(eq(users.id, userId)),
      ...this.revokeCredentials(userId, 'password_reset'),
    ]);
  }

  async applyEmailChange(
    userId: string,
    newEmail: string,
    at: Date,
  ): Promise<'changed' | 'email-in-use'> {
    try {
      await this.db.batch([
        this.db
          .update(users)
          .set({
            email: newEmail,
            emailVerifiedAt: at,
            disposableEmailStatus: null,
            disposableEmailCheckedAt: null,
            updatedAt: at,
          })
          .where(eq(users.id, userId)),
        ...this.revokeCredentials(userId, 'email_change'),
      ]);
      return 'changed';
    } catch (error) {
      if (uniqueViolationColumns(error).has(EMAIL_COLUMN)) {
        return 'email-in-use';
      }
      throw error;
    }
  }

  async applyPasswordChange(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.db.batch([
      this.db.update(users).set({ passwordHash }).where(eq(users.id, userId)),
      ...this.revokeCredentials(userId, 'password_change'),
    ]);
  }

  async listUndetermined(
    checkedBefore: Date,
    limit: number,
  ): Promise<readonly string[]> {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.disposableEmailStatus, 'undetermined'),
          lt(users.disposableEmailCheckedAt, checkedBefore),
          isNotNull(users.emailVerifiedAt),
          isNull(users.deletedAt),
        ),
      )
      .orderBy(asc(users.disposableEmailCheckedAt), asc(users.id))
      .limit(limit);
    return rows.map((row) => row.id);
  }

  private revokeCredentials(
    userId: string,
    completing: CompletingAuthTokenPurpose,
  ) {
    return [
      this.db.delete(userSessions).where(eq(userSessions.userId, userId)),
      this.db
        .delete(userAuthTokens)
        .where(
          and(
            eq(userAuthTokens.userId, userId),
            inArray(
              userAuthTokens.purpose,
              AUTH_TOKEN_PURPOSES_REVOKED_ON_COMPLETION[completing],
            ),
          ),
        ),
    ] as const;
  }
}
