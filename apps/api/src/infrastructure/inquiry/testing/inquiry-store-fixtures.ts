import { env } from 'cloudflare:workers';
import { asc, eq } from 'drizzle-orm';

import type { AuditTargetKind } from '../../../../common-lib/admin/audit-action.ts';
import { createDatabase } from '../../../../db/client.ts';
import { adminAuditLogTargets } from '../../../../db/schema/admin/admin-audit-log-targets.ts';
import { adminAuditLogs } from '../../../../db/schema/admin/admin-audit-logs.ts';
import { guestInquiries } from '../../../../db/schema/inquiry/guest-inquiries.ts';
import { inquiryCategories } from '../../../../db/schema/inquiry/inquiry-categories.ts';
import { inquiryMessageAttachments } from '../../../../db/schema/inquiry/inquiry-message-attachments.ts';
import { inquiryMessages } from '../../../../db/schema/inquiry/inquiry-messages.ts';
import { memberInquiries } from '../../../../db/schema/inquiry/member-inquiries.ts';
import type { PreparedAuditEntry } from '../../../../lib/core/admin/audit-log.ts';
import { userIdOf } from '../../../../lib/workers/identity/testing/identity-store-fixtures.ts';

export const T0 = new Date('2026-11-05T00:00:00.000Z');

export const db = createDatabase(env.DB);

export const OPERATOR_ADMIN_ID = '01JC0ADMN00000000000000001';

type MemberInquiryRow = typeof memberInquiries.$inferInsert;

type GuestInquiryRow = typeof guestInquiries.$inferInsert;

type InquiryMessageRow = typeof inquiryMessages.$inferInsert;

export function after(milliseconds: number): Date {
  return new Date(T0.getTime() + milliseconds);
}

export function categoryIdOf(index: number): string {
  return `01JC0CTGY${String(index).padStart(17, '0')}`;
}

export function memberInquiryIdOf(index: number): string {
  return `01JC0MINQ${String(index).padStart(17, '0')}`;
}

export function guestInquiryIdOf(index: number): string {
  return `01JC0GINQ${String(index).padStart(17, '0')}`;
}

export function messageIdOf(index: number): string {
  return `01JC0IMSG${String(index).padStart(17, '0')}`;
}

export function fileIdOf(index: number): string {
  return `01JC0FILE${String(index).padStart(17, '0')}`;
}

export function auditLogIdOf(index: number): string {
  return `01JC0ALOG${String(index).padStart(17, '0')}`;
}

// 初期データの標準カテゴリはマイグレーションで常に入るため残し、各テストの前にそれ以外の問い合わせの行と監査ログを消す
export async function resetInquiryTables(): Promise<void> {
  await db.batch([
    db.delete(inquiryMessageAttachments),
    db.delete(inquiryMessages),
    db.delete(memberInquiries),
    db.delete(guestInquiries),
    db
      .delete(inquiryCategories)
      .where(eq(inquiryCategories.systemDefault, false)),
    db.delete(adminAuditLogTargets),
    db.delete(adminAuditLogs),
  ]);
}

export async function insertCategory(
  index: number,
  name: string,
  createdAt: Date = T0,
): Promise<void> {
  await db.insert(inquiryCategories).values({
    id: categoryIdOf(index),
    name,
    createdAt,
    updatedAt: createdAt,
  });
}

// 利用者の行は呼び出し側がidentityの補助のinsertUserで先に入れる
export async function insertMemberInquiry(
  index: number,
  columns: Partial<MemberInquiryRow> & { readonly categoryId: string },
  userIndex = 1,
): Promise<void> {
  await db.insert(memberInquiries).values({
    id: memberInquiryIdOf(index),
    userId: userIdOf(userIndex),
    statusChangedAt: T0,
    lastMessageAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  });
}

export async function insertGuestInquiry(
  index: number,
  columns: Partial<GuestInquiryRow> & { readonly categoryId: string },
): Promise<void> {
  await db.insert(guestInquiries).values({
    id: guestInquiryIdOf(index),
    nickname: `ゲスト${String(index)}`,
    email: `guest${String(index)}@mail.example`,
    body: `問い合わせの本文${String(index)}`,
    statusChangedAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  });
}

export async function insertInquiryMessage(
  index: number,
  columns: Partial<InquiryMessageRow> & { readonly inquiryId: string },
): Promise<void> {
  await db.insert(inquiryMessages).values({
    id: messageIdOf(index),
    senderKind: 'user',
    body: `メッセージ${String(index)}`,
    createdAt: T0,
    ...columns,
  });
}

export async function insertAttachments(
  messageId: string,
  fileIds: readonly string[],
): Promise<void> {
  if (fileIds.length === 0) {
    return;
  }
  await db
    .insert(inquiryMessageAttachments)
    .values(
      fileIds.map((fileId, position) => ({ messageId, fileId, position })),
    );
}

export interface PreparedAuditEntryOptions {
  readonly action: string;
  readonly targetKind: AuditTargetKind;
  readonly targetIds: readonly string[];
  readonly detail?: Readonly<Record<string, string>>;
  readonly occurredAt?: Date;
}

// 準備済みの印は記録の実装だけが付けるため、ストアの検査では検証済みと同じ形の値を型の表明で作る
export function preparedAuditEntryOf(
  index: number,
  options: PreparedAuditEntryOptions,
): PreparedAuditEntry {
  return {
    id: auditLogIdOf(index),
    operatorAdminId: OPERATOR_ADMIN_ID,
    action: options.action,
    targetKind: options.targetKind,
    targetIds: options.targetIds,
    reason: null,
    detail: options.detail ?? {},
    occurredAt: options.occurredAt ?? T0,
  } as PreparedAuditEntry;
}

export async function readCategoryRows() {
  return db.select().from(inquiryCategories).orderBy(asc(inquiryCategories.id));
}

export async function readMemberInquiryCategoryIds(): Promise<
  readonly { readonly id: string; readonly categoryId: string }[]
> {
  return db
    .select({ id: memberInquiries.id, categoryId: memberInquiries.categoryId })
    .from(memberInquiries)
    .orderBy(asc(memberInquiries.id));
}

export async function readGuestInquiryCategoryIds(): Promise<
  readonly { readonly id: string; readonly categoryId: string }[]
> {
  return db
    .select({ id: guestInquiries.id, categoryId: guestInquiries.categoryId })
    .from(guestInquiries)
    .orderBy(asc(guestInquiries.id));
}

export async function readAuditLogs() {
  const [logs, targets] = await Promise.all([
    db
      .select({
        id: adminAuditLogs.id,
        operatorAdminId: adminAuditLogs.operatorAdminId,
        action: adminAuditLogs.action,
        targetKind: adminAuditLogs.targetKind,
        detail: adminAuditLogs.detail,
      })
      .from(adminAuditLogs)
      .orderBy(asc(adminAuditLogs.id)),
    db
      .select({
        logId: adminAuditLogTargets.logId,
        targetId: adminAuditLogTargets.targetId,
      })
      .from(adminAuditLogTargets)
      .orderBy(asc(adminAuditLogTargets.id)),
  ]);
  return logs.map((log) => ({
    ...log,
    targetIds: targets
      .filter((target) => target.logId === log.id)
      .map((target) => target.targetId),
  }));
}

export async function readMemberInquiryRows() {
  return db.select().from(memberInquiries).orderBy(asc(memberInquiries.id));
}

export async function readGuestInquiryRows() {
  return db.select().from(guestInquiries).orderBy(asc(guestInquiries.id));
}

export async function readMessageRows() {
  return db.select().from(inquiryMessages).orderBy(asc(inquiryMessages.id));
}

export async function readAttachmentRows() {
  return db
    .select()
    .from(inquiryMessageAttachments)
    .orderBy(
      asc(inquiryMessageAttachments.messageId),
      asc(inquiryMessageAttachments.position),
    );
}
