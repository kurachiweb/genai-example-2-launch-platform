import {
  and,
  desc,
  eq,
  exists,
  getColumns,
  gt,
  inArray,
  isNotNull,
  ne,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';
import { ulid } from 'ulid';

import type { Database } from '../../../db/client.ts';
import { adminAuthTokens } from '../../../db/schema/admin/admin-auth-tokens.ts';
import { adminLoginChallenges } from '../../../db/schema/admin/admin-login-challenges.ts';
import { adminRecoveryCodes } from '../../../db/schema/admin/admin-recovery-codes.ts';
import { adminSessions } from '../../../db/schema/admin/admin-sessions.ts';
import { adminTotpCredentials } from '../../../db/schema/admin/admin-totp-credentials.ts';
import { admins } from '../../../db/schema/admin/admins.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { PreparedAuditEntry } from '../../application/admin/audit-log-recorder.ts';
import type {
  AdminAccountStore,
  AdminActivation,
  AdminProfileUpdate,
  AdminRecord,
  AdminRoleChange,
  NewAdminInvitationToken,
  NewInvitedAdmin,
} from '../../application/admin/ports.ts';
import type { AdminSnapshot } from '../../domain/admin/admin-account.ts';
import type { AdminAuthTokenPurpose } from '../../domain/admin/admin-auth-token-purpose.ts';
import {
  buildAuditLogStatements,
  isAuditGuardRejection,
} from './audit-log-statements.ts';

const ADMIN_RECORD_COLUMNS = {
  id: admins.id,
  role: admins.role,
  status: admins.status,
  invitationExpiresAt: admins.invitationExpiresAt,
  email: admins.email,
  passwordHash: admins.passwordHash,
  nickname: admins.nickname,
  title: admins.title,
  avatarFileId: admins.avatarFileId,
  createdAt: admins.createdAt,
  activatedAt: admins.activatedAt,
};

const MAX_BOUND_PARAMETERS = 100;

const RECOVERY_CODE_ROWS_PER_STATEMENT = Math.floor(
  MAX_BOUND_PARAMETERS / Object.keys(getColumns(adminRecoveryCodes)).length,
);

const EMAIL_COLUMN = 'admins.email';

const UNIQUE_VIOLATION_PATTERN = /UNIQUE constraint failed: ([^:]+)/u;

// 条件を満たさないときだけ管理者のIDにNULLを入れる挿入で一括の書き込み全体を取り消すため、その列の違反だけを条件の不成立として判別する
const NOT_INVITED_ACTIVATION = 'admin_sessions.admin_id';

const NOT_INVITED_REISSUE = 'admin_auth_tokens.admin_id';

const NOT_NULL_VIOLATION_PATTERN =
  /NOT NULL constraint failed: ([a-z_]+\.[a-z_]+)(?::|$)/u;

// 一括の書き込みの失敗はD1のエラーがcauseにSQLiteのエラーを持ち、文の組み立ての失敗はDrizzleQueryErrorが包むため、原因をたどって文言を調べる
function causeMatch(error: unknown, pattern: RegExp): string | undefined {
  for (let current = error; current instanceof Error; current = current.cause) {
    const matched = pattern.exec(current.message)?.[1];
    if (matched !== undefined) {
      return matched;
    }
  }
  return undefined;
}

function violatesUniqueEmail(error: unknown): boolean {
  return (
    causeMatch(error, UNIQUE_VIOLATION_PATTERN)
      ?.split(',')
      .some((column) => column.trim() === EMAIL_COLUMN) ?? false
  );
}

function violatesNotNull(error: unknown, column: string): boolean {
  return causeMatch(error, NOT_NULL_VIOLATION_PATTERN) === column;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

const nullUnless = (condition: SQL, value: string): SQL =>
  sql`CASE WHEN ${condition} THEN ${value} ELSE NULL END`;

@injectable()
export class D1AdminAccountStore implements AdminAccountStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async findById(adminId: string): Promise<AdminRecord | undefined> {
    const [row] = await this.db
      .select(ADMIN_RECORD_COLUMNS)
      .from(admins)
      .where(eq(admins.id, adminId));
    return row;
  }

  async findByEmail(email: string): Promise<AdminRecord | undefined> {
    const [row] = await this.db
      .select(ADMIN_RECORD_COLUMNS)
      .from(admins)
      .where(eq(admins.email, email));
    return row;
  }

  async list(): Promise<readonly AdminRecord[]> {
    return this.db
      .select(ADMIN_RECORD_COLUMNS)
      .from(admins)
      .orderBy(desc(admins.createdAt), desc(admins.id));
  }

  async findProfiles(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, AdminRecord>> {
    const parts = chunk([...new Set(ids)], MAX_BOUND_PARAMETERS);
    const rows = await Promise.all(
      parts.map((part) =>
        this.db
          .select(ADMIN_RECORD_COLUMNS)
          .from(admins)
          .where(inArray(admins.id, part)),
      ),
    );
    return new Map(rows.flat().map((row) => [row.id, row]));
  }

  async insertInvited(
    admin: NewInvitedAdmin,
    token: NewAdminInvitationToken,
    audit: PreparedAuditEntry,
  ): Promise<'created' | 'email-in-use'> {
    try {
      await this.db.batch([
        this.db.insert(admins).values({
          id: admin.id,
          email: admin.email,
          role: 'viewer',
          status: 'invited',
          invitationExpiresAt: token.expiresAt,
          createdAt: admin.invitedAt,
          updatedAt: admin.invitedAt,
        }),
        this.db.insert(adminAuthTokens).values({
          adminId: admin.id,
          purpose: 'invitation',
          tokenHash: token.tokenHash,
          expiresAt: token.expiresAt,
          createdAt: admin.invitedAt,
          updatedAt: admin.invitedAt,
        }),
        ...buildAuditLogStatements(this.db, audit),
      ]);
      return 'created';
    } catch (error) {
      if (violatesUniqueEmail(error)) {
        return 'email-in-use';
      }
      throw error;
    }
  }

  // 招待中でなければ新しいトークンの管理者のIDがNULLになり、NOT NULL制約の違反で全体が取り消される
  async reissueInvitation(
    adminId: string,
    token: NewAdminInvitationToken,
    audit: PreparedAuditEntry,
  ): Promise<'reissued' | 'not-invited'> {
    const tokenId = ulid();
    const at = audit.occurredAt;
    try {
      await this.db.batch([
        this.db.insert(adminAuthTokens).values({
          id: tokenId,
          adminId: nullUnless(this.isInvited(adminId), adminId),
          purpose: 'invitation',
          tokenHash: token.tokenHash,
          expiresAt: token.expiresAt,
          createdAt: at,
          updatedAt: at,
        }),
        this.db
          .delete(adminAuthTokens)
          .where(
            and(
              eq(adminAuthTokens.adminId, adminId),
              eq(adminAuthTokens.purpose, 'invitation'),
              ne(adminAuthTokens.id, tokenId),
            ),
          ),
        this.db
          .update(admins)
          .set({ invitationExpiresAt: token.expiresAt, updatedAt: at })
          .where(eq(admins.id, adminId)),
        ...buildAuditLogStatements(this.db, audit),
      ]);
      return 'reissued';
    } catch (error) {
      if (violatesNotNull(error, NOT_INVITED_REISSUE)) {
        return 'not-invited';
      }
      throw error;
    }
  }

  async savePendingProfile(
    adminId: string,
    input: { readonly nickname: string; readonly passwordHash: string },
  ): Promise<void> {
    await this.db
      .update(admins)
      .set({ nickname: input.nickname, passwordHash: input.passwordHash })
      .where(and(eq(admins.id, adminId), eq(admins.status, 'invited')));
  }

  // 仮の保存を済ませた招待中で、照合した保留が期限内のまま残っていなければ、セッションの管理者のIDがNULLになり、NOT NULL制約の違反で全体が取り消される
  async activate(
    adminId: string,
    activation: AdminActivation,
  ): Promise<'activated' | 'not-invited'> {
    const { at, step, pendingSealedSecret, recoveryHashes, session } =
      activation;
    const activatable = sql`(${this.hasPendingProfile(adminId)} AND ${this.hasVerifiedPending(adminId, pendingSealedSecret, at)})`;
    try {
      await this.db.batch([
        this.db.insert(adminSessions).values({
          id: session.id,
          adminId: nullUnless(activatable, adminId),
          tokenHash: session.tokenHash,
          userAgent: session.userAgent,
          lastUsedAt: session.lastUsedAt,
          absoluteExpiresAt: session.absoluteExpiresAt,
          createdAt: session.createdAt,
          updatedAt: session.createdAt,
        }),
        this.db
          .update(adminTotpCredentials)
          .set({
            sealedSecret: sql`${adminTotpCredentials.pendingSealedSecret}`,
            enabledAt: at,
            lastUsedStep: step,
            pendingSealedSecret: null,
            pendingExpiresAt: null,
            updatedAt: at,
          })
          .where(eq(adminTotpCredentials.adminId, adminId)),
        this.db
          .delete(adminRecoveryCodes)
          .where(eq(adminRecoveryCodes.adminId, adminId)),
        ...this.recoveryCodeInserts(adminId, recoveryHashes, at),
        this.tokenDeletion(adminId, ['invitation']),
        this.db
          .update(admins)
          .set({
            status: 'active',
            activatedAt: at,
            invitationExpiresAt: null,
            updatedAt: at,
          })
          .where(eq(admins.id, adminId)),
      ]);
      return 'activated';
    } catch (error) {
      if (violatesNotNull(error, NOT_INVITED_ACTIVATION)) {
        return 'not-invited';
      }
      throw error;
    }
  }

  async deleteGuarded(
    operator: AdminSnapshot,
    targetId: string,
    audit: PreparedAuditEntry,
  ): Promise<'deleted' | 'rejected'> {
    try {
      await this.db.batch([
        ...buildAuditLogStatements(this.db, audit, {
          kind: 'delete',
          operator,
          targetId,
        }),
        this.db
          .delete(adminRecoveryCodes)
          .where(eq(adminRecoveryCodes.adminId, targetId)),
        this.db
          .delete(adminTotpCredentials)
          .where(eq(adminTotpCredentials.adminId, targetId)),
        this.db
          .delete(adminLoginChallenges)
          .where(eq(adminLoginChallenges.adminId, targetId)),
        this.db
          .delete(adminAuthTokens)
          .where(eq(adminAuthTokens.adminId, targetId)),
        this.sessionDeletion(targetId),
        this.db.delete(admins).where(eq(admins.id, targetId)),
      ]);
      return 'deleted';
    } catch (error) {
      if (isAuditGuardRejection(error)) {
        return 'rejected';
      }
      throw error;
    }
  }

  async changeRoleGuarded(
    operator: AdminSnapshot,
    change: AdminRoleChange,
    audit: PreparedAuditEntry,
  ): Promise<'changed' | 'rejected'> {
    try {
      await this.db.batch([
        ...buildAuditLogStatements(this.db, audit, {
          kind: 'role-change',
          operator,
          ...change,
        }),
        this.db
          .update(admins)
          .set({ role: change.toRole, updatedAt: audit.occurredAt })
          .where(eq(admins.id, change.targetId)),
      ]);
      return 'changed';
    } catch (error) {
      if (isAuditGuardRejection(error)) {
        return 'rejected';
      }
      throw error;
    }
  }

  async updateProfile(
    adminId: string,
    input: AdminProfileUpdate,
  ): Promise<void> {
    await this.db
      .update(admins)
      .set({
        nickname: input.nickname,
        title: input.title,
        avatarFileId: input.avatarFileId,
      })
      .where(eq(admins.id, adminId));
  }

  async applyPasswordReset(
    adminId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.db.batch([
      this.db
        .update(admins)
        .set({ passwordHash })
        .where(eq(admins.id, adminId)),
      this.sessionDeletion(adminId),
      this.tokenDeletion(adminId, ['password_reset']),
    ]);
  }

  async applyEmailChange(
    adminId: string,
    newEmail: string,
  ): Promise<'changed' | 'email-in-use'> {
    try {
      await this.db.batch([
        this.db
          .update(admins)
          .set({ email: newEmail })
          .where(eq(admins.id, adminId)),
        this.sessionDeletion(adminId),
        this.tokenDeletion(adminId, ['email_change']),
      ]);
      return 'changed';
    } catch (error) {
      if (violatesUniqueEmail(error)) {
        return 'email-in-use';
      }
      throw error;
    }
  }

  async applyPasswordChange(
    adminId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.db.batch([
      this.db
        .update(admins)
        .set({ passwordHash })
        .where(eq(admins.id, adminId)),
      this.sessionDeletion(adminId),
    ]);
  }

  private isInvited(adminId: string): SQL {
    return exists(
      this.db
        .select({ one: sql`1` })
        .from(admins)
        .where(and(eq(admins.id, adminId), eq(admins.status, 'invited'))),
    );
  }

  // 有効な管理者はパスワードとニックネームを必ず持つため、仮の保存の前の招待は有効にしない
  private hasPendingProfile(adminId: string): SQL {
    return exists(
      this.db
        .select({ one: sql`1` })
        .from(admins)
        .where(
          and(
            eq(admins.id, adminId),
            eq(admins.status, 'invited'),
            isNotNull(admins.passwordHash),
            isNotNull(admins.nickname),
          ),
        ),
    );
  }

  // 期限ちょうどを期限切れとするため、期限が有効化の時刻より後の保留だけを有効とする
  private hasVerifiedPending(
    adminId: string,
    pendingSealedSecret: string,
    at: Date,
  ): SQL {
    return exists(
      this.db
        .select({ one: sql`1` })
        .from(adminTotpCredentials)
        .where(
          and(
            eq(adminTotpCredentials.adminId, adminId),
            eq(adminTotpCredentials.pendingSealedSecret, pendingSealedSecret),
            gt(adminTotpCredentials.pendingExpiresAt, at),
          ),
        ),
    );
  }

  private recoveryCodeInserts(
    adminId: string,
    hashes: readonly string[],
    at: Date,
  ): BatchItem<'sqlite'>[] {
    const rows = hashes.map((codeHash) => ({
      adminId,
      codeHash,
      createdAt: at,
      updatedAt: at,
    }));
    return chunk(rows, RECOVERY_CODE_ROWS_PER_STATEMENT).map((part) =>
      this.db.insert(adminRecoveryCodes).values(part),
    );
  }

  private sessionDeletion(adminId: string) {
    return this.db
      .delete(adminSessions)
      .where(eq(adminSessions.adminId, adminId));
  }

  private tokenDeletion(
    adminId: string,
    purposes: readonly AdminAuthTokenPurpose[],
  ) {
    return this.db
      .delete(adminAuthTokens)
      .where(
        and(
          eq(adminAuthTokens.adminId, adminId),
          inArray(adminAuthTokens.purpose, [...purposes]),
        ),
      );
  }
}
