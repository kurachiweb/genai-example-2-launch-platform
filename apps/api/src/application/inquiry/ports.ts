import type {
  InquiryKind,
  InquiryStatus,
} from '../../../common-lib/inquiry/inquiry-status.ts';
import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';

export interface InquiryCategoryRecord {
  readonly id: string;
  readonly name: string;
  readonly systemDefault: boolean;
  readonly createdAt: Date;
}

export interface NewInquiryCategory {
  readonly id: string;
  readonly name: string;
  readonly at: Date;
}

export interface InquiryCategoryDeletion {
  readonly result: 'deleted' | 'not-found';
  readonly reassigned: number;
}

export interface InquiryCategoryStore {
  list(): Promise<readonly InquiryCategoryRecord[]>;
  findById(id: string): Promise<InquiryCategoryRecord | undefined>;
  // 名前は前後の空白を除いた値で、大文字小文字を区別せずに他のカテゴリと重なればname-takenを返す
  insert(
    category: NewInquiryCategory,
    audit: PreparedAuditEntry,
  ): Promise<'created' | 'name-taken'>;
  rename(
    id: string,
    name: string,
    at: Date,
    audit: PreparedAuditEntry,
  ): Promise<'renamed' | 'name-taken' | 'not-found'>;
  // ログイン・未ログインの両方の問い合わせの「その他」への付け替え・カテゴリの削除・監査ログを1つの一括の書き込みで確定させる。標準カテゴリは条件により削除しない
  deleteAndReassign(
    id: string,
    audit: PreparedAuditEntry,
  ): Promise<InquiryCategoryDeletion>;
  countLinked(id: string): Promise<number>;
  // 両方の問い合わせのテーブルのカテゴリごとの件数の和。紐付く問い合わせが無いカテゴリは含めない
  countLinkedByCategory(): Promise<ReadonlyMap<string, number>>;
}

export interface NewGuestInquiry {
  readonly id: string;
  readonly categoryId: string;
  readonly nickname: string;
  readonly email: string;
  readonly body: string;
  readonly at: Date;
}

export interface GuestInquiryStore {
  insert(inquiry: NewGuestInquiry): Promise<void>;
  // 対応済・却下でstatus_changed_atが閾値以前の行を、上限の件数まで物理削除して件数を返す
  deleteClosedBefore(threshold: Date, limit: number): Promise<number>;
}

export interface GuestInquiryRateLimit {
  // 上限を超えたらAppError(rate_limited, rate_limit_exceeded)とRetry-Afterの秒数を投げる。送信元IPアドレスが不明なら数えずに警告だけを残す
  consume(clientIp: string | undefined, now: Date): Promise<void>;
}

export interface NewInquiryMessage {
  readonly id: string;
  readonly body: string;
  readonly fileIds: readonly string[];
  readonly at: Date;
}

export interface NewMemberInquiry {
  readonly id: string;
  readonly userId: string;
  readonly categoryId: string;
  readonly at: Date;
  readonly firstMessage: NewInquiryMessage;
}

export interface MemberInquiryRecord {
  readonly id: string;
  readonly userId: string;
  readonly categoryId: string;
  readonly status: InquiryStatus;
  readonly statusChangedAt: Date;
  readonly lastMessageAt: Date;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
}

export interface InquiryMessageRecord {
  readonly id: string;
  readonly inquiryId: string;
  readonly sender: 'user' | 'admin';
  readonly adminId: string | null;
  readonly body: string;
  readonly fileIds: readonly string[];
  readonly createdAt: Date;
}

export interface MemberInquiryPage {
  readonly items: readonly MemberInquiryRecord[];
  readonly nextCursor: string | null;
}

export interface NewAdminReply {
  readonly id: string;
  readonly adminId: string;
  readonly body: string;
  readonly at: Date;
}

export interface MemberInquiryStore {
  // 問い合わせ・最初のメッセージ・添付の紐付けを1つの一括の書き込みで確定させる
  insert(inquiry: NewMemberInquiry): Promise<void>;
  findById(id: string): Promise<MemberInquiryRecord | undefined>;
  // 送信日時の古い順
  listMessages(inquiryId: string): Promise<readonly InquiryMessageRecord[]>;
  // 論理削除した問い合わせを除く
  listByUser(
    userId: string,
    page: { readonly after?: string; readonly limit: 20 },
  ): Promise<MemberInquiryPage>;
  // last_message_at・status・status_changed_at(ステータスが変わるときだけ)をメッセージと同時に更新する
  appendUserMessage(
    inquiryId: string,
    message: NewInquiryMessage,
    nextStatus: InquiryStatus,
  ): Promise<'appended' | 'not-found'>;
  appendAdminReply(
    inquiryId: string,
    reply: NewAdminReply,
    audit: PreparedAuditEntry,
  ): Promise<'appended' | 'not-found' | 'withdrawn'>;
}

export interface InquiryStatusTarget {
  readonly kind: InquiryKind;
  readonly id: string;
  readonly status: InquiryStatus;
  readonly withdrawn: boolean;
}

export interface InquiryStatusStore {
  // ログイン・未ログインの両方のテーブルから引く
  find(id: string): Promise<InquiryStatusTarget | undefined>;
  // 読み取った時点のステータスと退会の状態を条件に、監査ログと同じ一括の書き込みで変更する
  change(
    target: InquiryStatusTarget,
    next: InquiryStatus,
    at: Date,
    audit: PreparedAuditEntry,
  ): Promise<'changed' | 'conflict'>;
}

export interface AdminInquiryFilter {
  readonly status?: InquiryStatus;
  readonly kind?: InquiryKind;
  readonly categoryId?: string;
  readonly receivedFrom?: Date;
  readonly receivedBefore?: Date;
}

export interface AdminInquirySummary {
  readonly kind: InquiryKind;
  readonly id: string;
  readonly categoryId: string;
  readonly status: InquiryStatus;
  readonly senderName: string;
  readonly withdrawn: boolean;
  readonly createdAt: Date;
  readonly lastMessageAt: Date;
}

export interface AdminInquiryPage {
  readonly items: readonly AdminInquirySummary[];
  readonly nextCursor: string | null;
}

export interface GuestInquiryRecord {
  readonly id: string;
  readonly categoryId: string;
  readonly nickname: string;
  readonly email: string;
  readonly body: string;
  readonly status: InquiryStatus;
  readonly statusChangedAt: Date;
  readonly createdAt: Date;
}

export type AdminInquiryDetail =
  | { readonly kind: 'member'; readonly inquiry: MemberInquiryRecord }
  | { readonly kind: 'guest'; readonly inquiry: GuestInquiryRecord };

export interface InquiryAdminReader {
  list(
    filter: AdminInquiryFilter,
    page: { readonly after?: string; readonly limit: 50 },
  ): Promise<AdminInquiryPage>;
  findDetail(id: string): Promise<AdminInquiryDetail | undefined>;
  // 論理削除していない未対応のログインの問い合わせと、未対応の未ログインの問い合わせの和
  countUnhandled(): Promise<number>;
}

export interface InquirerProfile {
  readonly userId: string;
  readonly nickname: string;
  readonly handle: string;
  readonly avatarFileId: string | null;
}

export interface InquirerProfiles {
  findMany(
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, InquirerProfile>>;
}

export interface InquiryReplyNotification {
  readonly to: string;
  readonly nickname: string;
  readonly inquiryId: string;
  readonly repliedAt: Date;
}

export interface InquiryMailer {
  sendReplyNotification(input: InquiryReplyNotification): Promise<void>;
}

export interface InquirySettings {
  readonly clientOrigin: string;
}

export type InquiryIncidentKind =
  'reply-notification-failed' | 'attachment-release-failed';

export interface InquiryIncidentReporter {
  report(
    kind: InquiryIncidentKind,
    error: unknown,
    attributes: { readonly inquiryId?: string },
  ): void;
}
