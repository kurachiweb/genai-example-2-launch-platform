import type { AdminRole } from '../../../common-lib/admin/admin-roles.ts';
import type {
  SessionPolicy,
  SessionTimes,
} from '../../domain/auth/session-policy.ts';
import type { AdminSnapshot } from '../../domain/admin/admin-account.ts';
import type { AdminAuthTokenPurpose } from '../../domain/admin/admin-auth-token-purpose.ts';
import type {
  AuditLogFilter,
  AuditLogLatestManyQuery,
  AuditLogLatestQuery,
  AuditLogPageRequest,
  AuditLogSearchResult,
} from './audit-log-reader.ts';
import type { PreparedAuditEntry } from './audit-log-recorder.ts';

export interface AuditLogStore {
  insert(entry: PreparedAuditEntry): Promise<void>;
  // (occurred_at, id)の降順で、afterはbase64url('<ミリ秒>:<ID>')のカーソル
  search(
    filter: AuditLogFilter,
    page: AuditLogPageRequest,
  ): Promise<AuditLogSearchResult>;
  latestFor(input: AuditLogLatestQuery): Promise<Date | undefined>;
  // targetIdsは重複が無く1件以上で渡される。記録のある対象だけを含める
  latestForMany(
    input: AuditLogLatestManyQuery,
  ): Promise<ReadonlyMap<string, Date>>;
}

// identity-authのRequestMetaと同じ形を、identityの層に依存せずに持つ
export interface AdminRequestMeta {
  readonly clientIp: string | undefined;
  // 512文字までに切ったもの
  readonly userAgent: string | undefined;
  readonly now: Date;
}

export interface AdminRecord extends AdminSnapshot {
  readonly email: string;
  // 招待の完了前の仮の保存までnull
  readonly passwordHash: string | null;
  readonly nickname: string | null;
  readonly title: string | null;
  readonly avatarFileId: string | null;
  readonly createdAt: Date;
  readonly activatedAt: Date | null;
}

export interface NewInvitedAdmin {
  readonly id: string;
  // 前後の空白を除いた入力
  readonly email: string;
  readonly invitedAt: Date;
}

// 招待のトークンは管理者と用途が決まっているため、ハッシュと期限だけを受け取る。期限は管理者の招待の期限にもなる
export interface NewAdminInvitationToken {
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export interface NewAdminAuthToken {
  readonly adminId: string;
  readonly purpose: Exclude<AdminAuthTokenPurpose, 'invitation'>;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  // email_changeだけ
  readonly newEmail?: string;
}

export interface ConsumedAdminAuthToken {
  readonly adminId: string;
  readonly newEmail: string | null;
}

export interface NewAdminSessionRecord extends SessionTimes {
  readonly id: string;
  readonly adminId: string;
  readonly tokenHash: string;
  readonly userAgent: string | null;
}

export type StoredAdminSession = NewAdminSessionRecord;

export interface AdminActivation {
  readonly at: Date;
  // 照合に使った認証コードの時間窓
  readonly step: number;
  // 照合に使った保留の秘密鍵。照合の後に設定が始め直されていれば有効化しない
  readonly pendingSealedSecret: string;
  readonly recoveryHashes: readonly string[];
  readonly session: NewAdminSessionRecord;
}

export interface AdminRoleChange {
  readonly targetId: string;
  // 読み取った対象のロール。書き込みの時点で変わっていれば取り消す
  readonly fromRole: AdminRole;
  readonly toRole: AdminRole;
}

export interface AdminProfileUpdate {
  // 前後の空白を除いた入力
  readonly nickname: string;
  readonly title: string | null;
  readonly avatarFileId: string | null;
}

export interface AdminAccountStore {
  findById(adminId: string): Promise<AdminRecord | undefined>;
  // 大文字小文字を区別しない
  findByEmail(email: string): Promise<AdminRecord | undefined>;
  // 招待中を含む全管理者を登録の新しい順に返す
  list(): Promise<readonly AdminRecord[]>;
  // 招待中を含む存在する管理者だけを返す
  findProfiles(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, AdminRecord>>;
  // 閲覧のみの招待中の管理者・招待のトークン・監査ログを1つの一括の書き込みで作る
  insertInvited(
    admin: NewInvitedAdmin,
    token: NewAdminInvitationToken,
    audit: PreparedAuditEntry,
  ): Promise<'created' | 'email-in-use'>;
  // 招待中のときだけ、未使用の招待のトークンの置き換え・招待の期限の更新・監査ログを1つの一括の書き込みで行う
  reissueInvitation(
    adminId: string,
    token: NewAdminInvitationToken,
    audit: PreparedAuditEntry,
  ): Promise<'reissued' | 'not-invited'>;
  // 招待中のときだけ保存する
  savePendingProfile(
    adminId: string,
    input: { readonly nickname: string; readonly passwordHash: string },
  ): Promise<void>;
  // 仮の保存(パスワードとニックネーム)を済ませた招待中で、照合した保留が期限内のまま残っているときだけ、有効化・TOTPの確定・リカバリコードとセッションの追加・残りの招待のトークンの削除を1つの一括の書き込みで行う
  activate(
    adminId: string,
    activation: AdminActivation,
  ): Promise<'activated' | 'not-invited'>;
  // 監査ログの条件付きの記録を先頭に、子の行と管理者の行を削除する。条件を満たさなければ何も変えずにrejectedを返す
  deleteGuarded(
    operator: AdminSnapshot,
    targetId: string,
    audit: PreparedAuditEntry,
  ): Promise<'deleted' | 'rejected'>;
  // 監査ログの条件付きの記録を先頭に、ロールを変える。条件を満たさなければ何も変えずにrejectedを返す
  changeRoleGuarded(
    operator: AdminSnapshot,
    change: AdminRoleChange,
    audit: PreparedAuditEntry,
  ): Promise<'changed' | 'rejected'>;
  updateProfile(adminId: string, input: AdminProfileUpdate): Promise<void>;
  // 更新・全セッションと未使用のリセットのトークンの削除を1つの一括の書き込みで行う
  applyPasswordReset(adminId: string, passwordHash: string): Promise<void>;
  // 更新・全セッションと未使用の変更のトークンの削除を1つの一括の書き込みで行う
  applyEmailChange(
    adminId: string,
    newEmail: string,
  ): Promise<'changed' | 'email-in-use'>;
  // 更新・全セッションの削除を1つの一括の書き込みで行う
  applyPasswordChange(adminId: string, passwordHash: string): Promise<void>;
}

export interface AdminSessionStore {
  insert(session: NewAdminSessionRecord): Promise<void>;
  findByTokenHash(
    tokenHash: string,
  ): Promise<
    (StoredAdminSession & { readonly admin: AdminSnapshot }) | undefined
  >;
  touch(sessionId: string, at: Date): Promise<void>;
  deleteOne(adminId: string, sessionId: string): Promise<boolean>;
  // アイドルまたは絶対の期限切れをlimit件まで削除する
  deleteExpired(
    now: Date,
    policy: SessionPolicy,
    limit: number,
  ): Promise<number>;
}

export interface AdminAuthTokenStore {
  // 同じ管理者・用途の未使用を消してから加えることを1つの一括の書き込みで行う
  replace(token: NewAdminAuthToken): Promise<void>;
  // 消費せずに読む
  findValid(
    purpose: AdminAuthTokenPurpose,
    tokenHash: string,
    now: Date,
  ): Promise<ConsumedAdminAuthToken | undefined>;
  // 期限内なら1文で削除して返すため、同じトークンの2回目は見つからない
  consume(
    purpose: AdminAuthTokenPurpose,
    tokenHash: string,
    now: Date,
  ): Promise<ConsumedAdminAuthToken | undefined>;
  deleteExpired(now: Date, limit: number): Promise<number>;
}

export interface NewAdminLoginChallenge {
  readonly id: string;
  readonly adminId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export interface AdminLoginChallengeStore {
  insert(challenge: NewAdminLoginChallenge): Promise<void>;
  findValid(
    tokenHash: string,
    now: Date,
  ): Promise<{ readonly id: string; readonly adminId: string } | undefined>;
  delete(id: string): Promise<void>;
  deleteExpired(now: Date, limit: number): Promise<number>;
}

export interface AdminTotpCredential {
  // 招待の完了前はnull
  readonly sealedSecret: string | null;
  readonly enabledAt: Date | null;
  readonly lastUsedStep: number | null;
  readonly pendingSealedSecret: string | null;
  readonly pendingExpiresAt: Date | null;
}

export interface AdminTotpPendingCommit {
  // 照合に使った保留の秘密鍵。照合の後に設定が始め直されていれば入れ替えない
  readonly pendingSealedSecret: string;
  readonly step: number;
  readonly at: Date;
  readonly recoveryHashes: readonly string[];
}

export interface AdminTotpCredentialStore {
  find(adminId: string): Promise<AdminTotpCredential | undefined>;
  // 保留の列だけを書き、現在の設定は変えない
  savePending(
    adminId: string,
    sealedSecret: string,
    expiresAt: Date,
  ): Promise<void>;
  // 有効な設定と期限内の保留があるときだけ、保留と現在の設定の入れ替え・リカバリコードの置き換え・全セッションの削除を1つの一括の書き込みで行う
  commitPendingRevokingSessions(
    adminId: string,
    commit: AdminTotpPendingCommit,
  ): Promise<'committed' | 'not-pending'>;
  // 使用済みの時間窓より新しいときだけ更新し、同じ時間窓の認証コードの再使用を拒否する
  advanceStep(adminId: string, step: number): Promise<boolean>;
  // 期限切れの保留をlimit件まで消す
  clearExpiredPending(now: Date, limit: number): Promise<number>;
}

export interface AdminRecoveryCodeStore {
  // 一致すれば削除する
  consume(adminId: string, codeHash: string): Promise<boolean>;
  // 未使用のコードの件数
  count(adminId: string): Promise<number>;
  // 多要素認証が有効なときだけ、未使用のコードの置き換え・全セッションの削除を1つの一括の書き込みで行う
  replaceAllRevokingSessions(
    adminId: string,
    hashes: readonly string[],
  ): Promise<'replaced' | 'not-enabled'>;
}

export interface IssuedAdminSession {
  readonly sessionId: string;
  // SESSION_TOKEN_PATTERNに合う平文
  readonly token: string;
  readonly maxAgeSeconds: number;
}

export interface AdminTotpSetupView {
  readonly otpauthUri: string;
  // 手入力用(base32)
  readonly secret: string;
  // 開始から10分
  readonly expiresAt: Date;
}

export interface AdminMailer {
  sendInvitation(to: string, token: string, expiresAt: Date): Promise<void>;
  sendEmailChangeConfirmation(
    admin: AdminRecord,
    newEmail: string,
    token: string,
    expiresAt: Date,
  ): Promise<void>;
  sendEmailChanged(
    previousEmail: string,
    admin: AdminRecord,
    at: Date,
  ): Promise<void>;
  sendPasswordReset(
    admin: AdminRecord,
    token: string,
    expiresAt: Date,
  ): Promise<void>;
  sendPasswordResetCompleted(admin: AdminRecord, at: Date): Promise<void>;
  sendPasswordChanged(admin: AdminRecord, at: Date): Promise<void>;
}

export interface AdminSettings {
  // ADMIN_SITE_ORIGIN
  readonly adminOrigin: string;
  readonly totpIssuer: string;
}

export type AdminLimitedMailKind = 'password_reset' | 'email_change';

export interface AdminMailSendLimits {
  // 宛先とIPアドレスのどちらかが上限を超えたら、AppError(rate_limited, rate_limit_exceeded)を投げる
  consume(
    kind: AdminLimitedMailKind,
    address: string,
    meta: AdminRequestMeta,
  ): Promise<void>;
}
