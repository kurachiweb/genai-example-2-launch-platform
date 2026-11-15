import { sqlStringLiteral } from '../../apps/api/scripts/admin/sql-string-literal.ts';
import type { NotificationTopic } from '../../apps/common-lib/notifications/notification-topics.ts';
import type { LocalD1Row } from './local-d1-command.ts';

// apps/backend-libのworkers/notifications/d1-sender-info-store.tsのSENDER_INFO_SETTING_KEYの写し。一致はルートのconfig/notification-contract-copies.unit.test.tsが確かめる
export const SENDER_INFO_SETTING_KEY = 'sender-info';

const SENDER_INFO_KEY_LITERAL = sqlStringLiteral(SENDER_INFO_SETTING_KEY);

export interface UnsubscribeLinkWrite {
  readonly userId: string;
  readonly topic: NotificationTopic;
  readonly preferenceId: string;
  readonly tokenRowId: string;
  readonly seed: string;
  // 導出したトークンの照合用のハッシュ
  readonly tokenHash: string;
  readonly at: Date;
}

export interface SenderInfoSnapshot {
  readonly businessName: string | null;
  readonly contactEmail: string | null;
  readonly postalAddress: string | null;
  readonly version: number;
  readonly updatedByAdminId: string | null;
  readonly updatedAt: number;
}

const integerLiteral = (value: number): string => {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `SQLの整数のリテラルにできない値です: ${String(value)}`,
    );
  }
  return String(value);
};

const nullableLiteral = (value: string | null): string =>
  value === null ? 'NULL' : sqlStringLiteral(value);

const valuesOf = (values: readonly string[]): string =>
  `(${values.join(', ')})`;

export function userIdByEmailSql(email: string): string {
  return `SELECT id FROM users WHERE email = ${sqlStringLiteral(email)} AND deleted_at IS NULL;`;
}

export function parseUserId(
  rows: readonly LocalD1Row[],
  email: string,
): string {
  const [row] = rows;
  if (rows.length !== 1 || typeof row?.id !== 'string') {
    throw new Error(`ローカルのD1に利用者${email}が見つかりません`);
  }
  return row.id;
}

// 配信停止のトークンは受信する設定の種別でだけ意味を持つため、受信する設定の行と組の種の行を作る。種の行が既にある組は、導出し直した照合用のハッシュで上書きせずに失敗させる
export function unsubscribeLinkInsertSql(write: UnsubscribeLinkWrite): string {
  const userId = sqlStringLiteral(write.userId);
  const topic = sqlStringLiteral(write.topic);
  const at = integerLiteral(write.at.getTime());
  return [
    `INSERT INTO notification_preferences (id, user_id, topic, enabled, created_at, updated_at) VALUES ${valuesOf([sqlStringLiteral(write.preferenceId), userId, topic, '1', at, at])} ON CONFLICT (user_id, topic) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at;`,
    `INSERT INTO notification_unsubscribe_tokens (id, user_id, topic, seed, token_hash, created_at, updated_at) VALUES ${valuesOf([sqlStringLiteral(write.tokenRowId), userId, topic, sqlStringLiteral(write.seed), sqlStringLiteral(write.tokenHash), at, at])} RETURNING id;`,
  ].join('\n');
}

export function parseUnsubscribeLinkInsert(
  rows: readonly LocalD1Row[],
  write: UnsubscribeLinkWrite,
): void {
  const [row] = rows;
  if (rows.length !== 1 || row?.id !== write.tokenRowId) {
    throw new Error(
      `ローカルのD1に利用者${write.userId}の${write.topic}の配信停止のトークンの種を作れませんでした`,
    );
  }
}

export const SENDER_INFO_SNAPSHOT_SQL = `SELECT business_name, contact_email, postal_address, version, updated_by_admin_id, updated_at FROM notification_sender_settings WHERE setting_key = ${SENDER_INFO_KEY_LITERAL};`;

const nullableStringOf = (row: LocalD1Row, key: string): string | null => {
  const value = row[key];
  if (value !== null && typeof value !== 'string') {
    throw new Error(
      `送信者情報の行の${key}が文字列でもNULLでもありません: ${JSON.stringify(value)}`,
    );
  }
  return value;
};

const integerOf = (row: LocalD1Row, key: string): number => {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(
      `送信者情報の行の${key}が整数ではありません: ${JSON.stringify(value)}`,
    );
  }
  return value;
};

// 送信者情報の行は初期データのマイグレーションが入れるため、行が無ければマイグレーションの未適用として失敗する
export function parseSenderInfoSnapshot(
  rows: readonly LocalD1Row[],
): SenderInfoSnapshot {
  const [row] = rows;
  if (rows.length !== 1 || row === undefined) {
    throw new Error(
      `ローカルのD1に送信者情報の行(setting_key = ${SENDER_INFO_SETTING_KEY})がありません。apps/apiでbun run db:migrate:localを実行してください`,
    );
  }
  return {
    businessName: nullableStringOf(row, 'business_name'),
    contactEmail: nullableStringOf(row, 'contact_email'),
    postalAddress: nullableStringOf(row, 'postal_address'),
    version: integerOf(row, 'version'),
    updatedByAdminId: nullableStringOf(row, 'updated_by_admin_id'),
    updatedAt: integerOf(row, 'updated_at'),
  };
}

// 版0は3項目がNULLであることをCHECK制約が求めるため、版も含めて読んだ時点の行へそのまま戻す
export function senderInfoRestoreSql(snapshot: SenderInfoSnapshot): string {
  return `UPDATE notification_sender_settings SET business_name = ${nullableLiteral(snapshot.businessName)}, contact_email = ${nullableLiteral(snapshot.contactEmail)}, postal_address = ${nullableLiteral(snapshot.postalAddress)}, version = ${integerLiteral(snapshot.version)}, updated_by_admin_id = ${nullableLiteral(snapshot.updatedByAdminId)}, updated_at = ${integerLiteral(snapshot.updatedAt)} WHERE setting_key = ${SENDER_INFO_KEY_LITERAL} RETURNING id;`;
}
