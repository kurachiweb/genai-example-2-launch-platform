import { asc, eq, inArray } from 'drizzle-orm';

import { INQUIRY_CATEGORY_OTHER_ID } from '../../../../common-lib/inquiry/inquiry-category-constants.ts';
import { inquiryMessageAttachments } from '../../../../db/schema/inquiry/inquiry-message-attachments.ts';
import { inquiryMessages } from '../../../../db/schema/inquiry/inquiry-messages.ts';
import { memberInquiries } from '../../../../db/schema/inquiry/member-inquiries.ts';
import {
  db,
  T0,
  userIdOf,
} from '../../../../lib/workers/identity/testing/identity-store-fixtures.ts';

// 問い合わせの行は9列のため、1文のバインド変数を100個以内に収める行数で入れる
const INQUIRY_ROWS_PER_INSERT = 11;

export function memberInquiryIdOf(index: number): string {
  return `01JC0MEMBERQ${String(index).padStart(14, '0')}`;
}

export function messageIdOf(index: number): string {
  return `01JC0MESSAGE${String(index).padStart(14, '0')}`;
}

export function fileIdOf(index: number): string {
  return `01JC0ATTACH${String(index).padStart(15, '0')}`;
}

// 標準カテゴリはマイグレーションの初期データで入るため残す
export async function resetMemberInquiryRows(): Promise<void> {
  await db.batch([
    db.delete(inquiryMessageAttachments),
    db.delete(inquiryMessages),
    db.delete(memberInquiries),
  ]);
}

// 利用者の行は呼び出し側がidentityの補助のinsertUserで先に入れる
export async function insertMemberInquiries(
  userIndex: number,
  inquiryIndexes: readonly number[],
  deletedAt: Date | null = T0,
): Promise<void> {
  const rows = inquiryIndexes.map((index) => ({
    id: memberInquiryIdOf(index),
    userId: userIdOf(userIndex),
    categoryId: INQUIRY_CATEGORY_OTHER_ID,
    statusChangedAt: T0,
    lastMessageAt: T0,
    createdAt: T0,
    updatedAt: T0,
    deletedAt,
  }));
  for (let start = 0; start < rows.length; start += INQUIRY_ROWS_PER_INSERT) {
    await db
      .insert(memberInquiries)
      .values(rows.slice(start, start + INQUIRY_ROWS_PER_INSERT));
  }
}

export async function insertMessageWithAttachments(
  messageIndex: number,
  inquiryIndex: number,
  fileIndexes: readonly number[],
): Promise<void> {
  await db.insert(inquiryMessages).values({
    id: messageIdOf(messageIndex),
    inquiryId: memberInquiryIdOf(inquiryIndex),
    senderKind: 'user',
    body: `メッセージ${String(messageIndex)}`,
    createdAt: T0,
  });
  if (fileIndexes.length > 0) {
    await db.insert(inquiryMessageAttachments).values(
      fileIndexes.map((fileIndex, position) => ({
        messageId: messageIdOf(messageIndex),
        fileId: fileIdOf(fileIndex),
        position,
      })),
    );
  }
}

export interface MemberInquiryRowsOfUser {
  readonly inquiryIds: readonly string[];
  readonly messageIds: readonly string[];
  readonly fileIds: readonly string[];
}

export async function readMemberInquiryRowsOf(
  userIndex: number,
): Promise<MemberInquiryRowsOfUser> {
  const inquiryIdsOfUser = db
    .select({ id: memberInquiries.id })
    .from(memberInquiries)
    .where(eq(memberInquiries.userId, userIdOf(userIndex)));
  const messageIdsOfUser = db
    .select({ id: inquiryMessages.id })
    .from(inquiryMessages)
    .where(inArray(inquiryMessages.inquiryId, inquiryIdsOfUser));
  const inquiries = await db
    .select({ id: memberInquiries.id })
    .from(memberInquiries)
    .where(eq(memberInquiries.userId, userIdOf(userIndex)))
    .orderBy(asc(memberInquiries.id));
  const messages = await db
    .select({ id: inquiryMessages.id })
    .from(inquiryMessages)
    .where(inArray(inquiryMessages.inquiryId, inquiryIdsOfUser))
    .orderBy(asc(inquiryMessages.id));
  const attachments = await db
    .select({ fileId: inquiryMessageAttachments.fileId })
    .from(inquiryMessageAttachments)
    .where(inArray(inquiryMessageAttachments.messageId, messageIdsOfUser))
    .orderBy(asc(inquiryMessageAttachments.fileId));
  return {
    inquiryIds: inquiries.map((row) => row.id),
    messageIds: messages.map((row) => row.id),
    fileIds: attachments.map((row) => row.fileId),
  };
}

export function indexesFrom(first: number, count: number): number[] {
  return Array.from({ length: count }, (_, offset) => first + offset);
}
