import { and, eq, exists, sql, type SQL } from 'drizzle-orm';
import { ulid } from 'ulid';

import type { Database } from '../../../db/client.ts';
import { userRecoveryCodes } from '../../../db/schema/identity/user-recovery-codes.ts';
import { userSessions } from '../../../db/schema/identity/user-sessions.ts';
import { userTotpCredentials } from '../../../db/schema/identity/user-totp-credentials.ts';

// 一括の書き込みの中では前の文の結果で後の文を分けられないため、各文を同じ一括の書き込みの中の資格情報の状態の条件付きにする。
// 条件は資格情報の行を書き換える文より前に置いた文で、書き換える前の状態に対して判定される

function credentialOfUserExists(
  db: Database,
  userId: string,
  credentialCondition: SQL | undefined,
) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(userTotpCredentials)
      .where(and(eq(userTotpCredentials.userId, userId), credentialCondition)),
  );
}

// 資格情報の行からの選択で挿入し、条件を満たす行が無ければ何も追加しない
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

export function recoveryCodeDeletionWhen(
  db: Database,
  userId: string,
  credentialCondition: SQL | undefined,
) {
  return db
    .delete(userRecoveryCodes)
    .where(
      and(
        eq(userRecoveryCodes.userId, userId),
        credentialOfUserExists(db, userId, credentialCondition),
      ),
    );
}

export function sessionDeletionWhen(
  db: Database,
  userId: string,
  credentialCondition: SQL | undefined,
) {
  return db
    .delete(userSessions)
    .where(
      and(
        eq(userSessions.userId, userId),
        credentialOfUserExists(db, userId, credentialCondition),
      ),
    );
}
