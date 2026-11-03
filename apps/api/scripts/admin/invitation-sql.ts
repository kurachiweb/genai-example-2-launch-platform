export interface InvitationSqlInput {
  readonly existingInvitedAdminId: string | undefined;
  readonly newAdminId: string;
  readonly email: string;
  readonly tokenId: string;
  readonly tokenHash: string;
  readonly now: Date;
  readonly expiresAt: Date;
}

const CONTROL_CHARACTER = /\p{Cc}/u;

const SUPER_ADMIN_ROLE = sqlStringLiteral('super_admin');

const INVITED_STATUS = sqlStringLiteral('invited');

const INVITATION_PURPOSE = sqlStringLiteral('invitation');

// 値はwranglerのコマンドの引数やSQLのファイルへ埋め込まれ、文の分割をwranglerに委ねるため、引用符の内側でも扱いが揺れ得る制御文字は受け付けない
export function sqlStringLiteral(value: string): string {
  if (CONTROL_CHARACTER.test(value)) {
    throw new Error('SQLの文字列のリテラルに制御文字は使えません。');
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function epochMillisLiteral(date: Date): string {
  const millis = date.getTime();
  if (!Number.isFinite(millis)) {
    throw new Error('日時が正しくありません。');
  }
  return String(millis);
}

export function buildLookupSql(email: string): string {
  return `SELECT id, status FROM admins WHERE email = ${sqlStringLiteral(email)} COLLATE NOCASE;`;
}

function promoteInvitedAdmin(
  adminId: string,
  expiresAt: string,
  now: string,
): readonly string[] {
  return [
    `UPDATE admins SET role = ${SUPER_ADMIN_ROLE}, invitation_expires_at = ${expiresAt}, updated_at = ${now} WHERE id = ${adminId} AND status = ${INVITED_STATUS};`,
    `DELETE FROM admin_auth_tokens WHERE admin_id = ${adminId} AND purpose = ${INVITATION_PURPOSE};`,
  ];
}

function insertInvitedAdmin(
  adminId: string,
  email: string,
  expiresAt: string,
  now: string,
): readonly string[] {
  return [
    `INSERT INTO admins (id, email, role, status, invitation_expires_at, created_at, updated_at) VALUES (${adminId}, ${email}, ${SUPER_ADMIN_ROLE}, ${INVITED_STATUS}, ${expiresAt}, ${now}, ${now});`,
  ];
}

// 照会の後に管理者が有効になっていれば管理者のIDがNULLになり、NOT NULL制約の違反で失敗させる
function insertInvitationToken(
  adminId: string,
  input: InvitationSqlInput,
  expiresAt: string,
  now: string,
): string {
  return `INSERT INTO admin_auth_tokens (id, admin_id, purpose, token_hash, expires_at, created_at, updated_at) VALUES (${sqlStringLiteral(input.tokenId)}, (SELECT id FROM admins WHERE id = ${adminId} AND status = ${INVITED_STATUS}), ${INVITATION_PURPOSE}, ${sqlStringLiteral(input.tokenHash)}, ${expiresAt}, ${now}, ${now});`;
}

export function buildInvitationSql(input: InvitationSqlInput): string {
  const now = epochMillisLiteral(input.now);
  const expiresAt = epochMillisLiteral(input.expiresAt);
  const adminId = sqlStringLiteral(
    input.existingInvitedAdminId ?? input.newAdminId,
  );
  const adminStatements =
    input.existingInvitedAdminId === undefined
      ? insertInvitedAdmin(
          adminId,
          sqlStringLiteral(input.email),
          expiresAt,
          now,
        )
      : promoteInvitedAdmin(adminId, expiresAt, now);
  return [
    ...adminStatements,
    insertInvitationToken(adminId, input, expiresAt, now),
    '',
  ].join('\n');
}
