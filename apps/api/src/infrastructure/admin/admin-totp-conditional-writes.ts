import { and, eq, exists, sql, type SQL } from 'drizzle-orm';
import { ulid } from 'ulid';

import type { Database } from '../../../db/client.ts';
import { adminRecoveryCodes } from '../../../db/schema/admin/admin-recovery-codes.ts';
import { adminSessions } from '../../../db/schema/admin/admin-sessions.ts';
import { adminTotpCredentials } from '../../../db/schema/admin/admin-totp-credentials.ts';

// 一括の書き込みの中では前の文の結果で後の文を分けられないため、各文を同じ一括の書き込みの中の資格情報の状態の条件付きにする。
// 条件は資格情報の行を書き換える文より前に置いた文で、書き換える前の状態に対して判定される

function credentialOfAdminExists(
  db: Database,
  adminId: string,
  credentialCondition: SQL | undefined,
) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(adminTotpCredentials)
      .where(
        and(eq(adminTotpCredentials.adminId, adminId), credentialCondition),
      ),
  );
}

// 資格情報の行からの選択で挿入し、条件を満たす行が無ければ何も追加しない
export function adminRecoveryCodeInsertsWhen(
  db: Database,
  adminId: string,
  hashes: readonly string[],
  at: Date,
  credentialCondition: SQL | undefined,
) {
  return hashes.map((codeHash) =>
    db.insert(adminRecoveryCodes).select(
      db
        .select({
          id: sql<string>`${ulid()}`.as('id'),
          adminId: adminTotpCredentials.adminId,
          codeHash: sql<string>`${codeHash}`.as('code_hash'),
          createdAt: sql<number>`${at.getTime()}`.as('created_at'),
          updatedAt: sql<number>`${at.getTime()}`.as('updated_at'),
        })
        .from(adminTotpCredentials)
        .where(
          and(eq(adminTotpCredentials.adminId, adminId), credentialCondition),
        ),
    ),
  );
}

export function adminRecoveryCodeDeletionWhen(
  db: Database,
  adminId: string,
  credentialCondition: SQL | undefined,
) {
  return db
    .delete(adminRecoveryCodes)
    .where(
      and(
        eq(adminRecoveryCodes.adminId, adminId),
        credentialOfAdminExists(db, adminId, credentialCondition),
      ),
    );
}

export function adminSessionDeletionWhen(
  db: Database,
  adminId: string,
  credentialCondition: SQL | undefined,
) {
  return db
    .delete(adminSessions)
    .where(
      and(
        eq(adminSessions.adminId, adminId),
        credentialOfAdminExists(db, adminId, credentialCondition),
      ),
    );
}
