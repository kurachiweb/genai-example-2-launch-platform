import {
  and,
  asc,
  desc,
  eq,
  getColumns,
  inArray,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import { INQUIRY_STATUSES } from '../../../common-lib/inquiry/inquiry-status.ts';
import { notDeleted } from '../../../db/schema/_shared/columns.ts';
import type { Database } from '../../../db/client.ts';
import { inquiryMessageAttachments } from '../../../db/schema/inquiry/inquiry-message-attachments.ts';
import { inquiryMessages } from '../../../db/schema/inquiry/inquiry-messages.ts';
import { memberInquiries } from '../../../db/schema/inquiry/member-inquiries.ts';
import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  InquiryMessageRecord,
  MemberInquiryPage,
  MemberInquiryRecord,
  MemberInquiryStore,
  NewAdminReply,
  NewInquiryMessage,
  NewMemberInquiry,
} from '../../application/inquiry/ports.ts';
import { statusAfterUserMessage } from '../../domain/inquiry/inquiry-status-rules.ts';
import {
  buildAuditLogStatements,
  isAuditGuardRejection,
} from '../admin/audit-log-statements.ts';
import { categoryReferenceFailureOf } from './category-reference-failure.ts';
import { afterInquiryCursor, inquiryPageOf } from './inquiry-page.ts';

type Statements = [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]];

const MAX_BOUND_PARAMETERS = 100;

const ATTACHMENT_ROWS_PER_STATEMENT = Math.floor(
  MAX_BOUND_PARAMETERS /
    Object.keys(getColumns(inquiryMessageAttachments)).length,
);

// 問い合わせが無いか論理削除済みのとき、メッセージの挿入だけがこの違反を起こす
const INACTIVE_INQUIRY_PATTERN =
  /NOT NULL constraint failed: inquiry_messages\.inquiry_id(?::|$)/u;

export const MEMBER_INQUIRY_RECORD_COLUMNS = {
  id: memberInquiries.id,
  userId: memberInquiries.userId,
  categoryId: memberInquiries.categoryId,
  status: memberInquiries.status,
  statusChangedAt: memberInquiries.statusChangedAt,
  lastMessageAt: memberInquiries.lastMessageAt,
  createdAt: memberInquiries.createdAt,
  deletedAt: memberInquiries.deletedAt,
};

const MESSAGE_COLUMNS = {
  id: inquiryMessages.id,
  inquiryId: inquiryMessages.inquiryId,
  sender: inquiryMessages.senderKind,
  adminId: inquiryMessages.adminId,
  body: inquiryMessages.body,
  createdAt: inquiryMessages.createdAt,
};

const REOPENED_STATUSES = INQUIRY_STATUSES.filter(
  (status) => statusAfterUserMessage(status) !== status,
);

// 読み取った後に管理者がステータスを変えても上書きしないよう、書き込みの時点の値から利用者の送信の規則で求める
const statusAfterMessage = sql`CASE ${memberInquiries.status} ${sql.join(
  INQUIRY_STATUSES.map(
    (status) => sql`WHEN ${status} THEN ${statusAfterUserMessage(status)}`,
  ),
  sql` `,
)} ELSE ${memberInquiries.status} END`;

const activeInquiry = (inquiryId: string): SQL | undefined =>
  and(eq(memberInquiries.id, inquiryId), notDeleted(memberInquiries.deletedAt));

const activeInquiryExists = (inquiryId: string): SQL =>
  sql`EXISTS (SELECT 1 FROM ${memberInquiries} WHERE ${activeInquiry(inquiryId)})`;

function isInactiveInquiry(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (INACTIVE_INQUIRY_PATTERN.test(current.message)) {
      return true;
    }
  }
  return false;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

@injectable()
export class D1MemberInquiryStore implements MemberInquiryStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  // ステータスは列の既定値の未対応にする。利用者は直前に書き込める状態を確かめ、行の物理削除は退会の後に限られるため、外部キーの違反はカテゴリの削除との競合だけになる
  async insert(inquiry: NewMemberInquiry): Promise<void> {
    const { firstMessage } = inquiry;
    try {
      await this.db.batch([
        this.db.insert(memberInquiries).values({
          id: inquiry.id,
          userId: inquiry.userId,
          categoryId: inquiry.categoryId,
          statusChangedAt: inquiry.at,
          lastMessageAt: firstMessage.at,
          createdAt: inquiry.at,
          updatedAt: inquiry.at,
        }),
        ...this.userMessageStatements(inquiry.id, firstMessage),
      ]);
    } catch (error) {
      throw categoryReferenceFailureOf(error);
    }
  }

  // 退会済みの扱いは呼び出し側が決めるため、論理削除した問い合わせも削除日時とともに返す
  async findById(id: string): Promise<MemberInquiryRecord | undefined> {
    const [row] = await this.db
      .select(MEMBER_INQUIRY_RECORD_COLUMNS)
      .from(memberInquiries)
      .where(eq(memberInquiries.id, id));
    return row;
  }

  async listMessages(
    inquiryId: string,
  ): Promise<readonly InquiryMessageRecord[]> {
    const [messages, attachments] = await Promise.all([
      this.db
        .select(MESSAGE_COLUMNS)
        .from(inquiryMessages)
        .where(eq(inquiryMessages.inquiryId, inquiryId))
        .orderBy(asc(inquiryMessages.createdAt), asc(inquiryMessages.id)),
      this.db
        .select({
          messageId: inquiryMessageAttachments.messageId,
          fileId: inquiryMessageAttachments.fileId,
        })
        .from(inquiryMessageAttachments)
        .innerJoin(
          inquiryMessages,
          eq(inquiryMessages.id, inquiryMessageAttachments.messageId),
        )
        .where(eq(inquiryMessages.inquiryId, inquiryId))
        .orderBy(
          asc(inquiryMessageAttachments.messageId),
          asc(inquiryMessageAttachments.position),
        ),
    ]);
    const fileIdsOf = Map.groupBy(attachments, (row) => row.messageId);
    return messages.map((message) => ({
      ...message,
      fileIds: (fileIdsOf.get(message.id) ?? []).map((row) => row.fileId),
    }));
  }

  async listByUser(
    userId: string,
    page: { readonly after?: string; readonly limit: 20 },
  ): Promise<MemberInquiryPage> {
    const rows = await this.db
      .select(MEMBER_INQUIRY_RECORD_COLUMNS)
      .from(memberInquiries)
      .where(
        and(
          eq(memberInquiries.userId, userId),
          notDeleted(memberInquiries.deletedAt),
          afterInquiryCursor(memberInquiries, page.after),
        ),
      )
      .orderBy(desc(memberInquiries.createdAt), desc(memberInquiries.id))
      .limit(page.limit + 1);
    return inquiryPageOf(rows, page.limit);
  }

  async appendUserMessage(
    inquiryId: string,
    message: NewInquiryMessage,
  ): Promise<'appended' | 'not-found'> {
    try {
      await this.db.batch([
        ...this.userMessageStatements(inquiryId, message, {
          requireActive: true,
        }),
        this.db
          .update(memberInquiries)
          .set({
            status: statusAfterMessage,
            statusChangedAt: sql`CASE WHEN ${inArray(memberInquiries.status, REOPENED_STATUSES)} THEN ${message.at.getTime()} ELSE ${memberInquiries.statusChangedAt} END`,
            lastMessageAt: message.at,
            updatedAt: message.at,
          })
          .where(activeInquiry(inquiryId)),
      ]);
      return 'appended';
    } catch (error) {
      if (isInactiveInquiry(error)) {
        return 'not-found';
      }
      throw error;
    }
  }

  async appendAdminReply(
    inquiryId: string,
    reply: NewAdminReply,
    audit: PreparedAuditEntry,
  ): Promise<'appended' | 'not-found' | 'withdrawn'> {
    try {
      await this.db.batch([
        ...buildAuditLogStatements(this.db, audit, {
          kind: 'condition',
          condition: activeInquiryExists(inquiryId),
        }),
        this.db.insert(inquiryMessages).values({
          id: reply.id,
          inquiryId,
          senderKind: 'admin',
          adminId: reply.adminId,
          body: reply.body,
          createdAt: reply.at,
        }),
        this.db
          .update(memberInquiries)
          .set({ lastMessageAt: reply.at, updatedAt: reply.at })
          .where(activeInquiry(inquiryId)),
      ]);
      return 'appended';
    } catch (error) {
      if (!isAuditGuardRejection(error)) {
        throw error;
      }
      // 論理削除は取り消されず行の物理削除は論理削除の後に限られるため、取り消しの後に読み直して原因を決める
      const inquiry = await this.findById(inquiryId);
      if (inquiry === undefined) {
        return 'not-found';
      }
      if (inquiry.deletedAt !== null) {
        return 'withdrawn';
      }
      throw error;
    }
  }

  // requireActiveのとき、問い合わせが無いか論理削除済みならメッセージの問い合わせのIDをNULLにし、NOT NULLの違反で一括の書き込み全体を取り消す
  private userMessageStatements(
    inquiryId: string,
    message: NewInquiryMessage,
    options: { readonly requireActive: boolean } = { requireActive: false },
  ): Statements {
    const attachmentRows = message.fileIds.map((fileId, position) => ({
      messageId: message.id,
      fileId,
      position,
    }));
    return [
      this.db.insert(inquiryMessages).values({
        id: message.id,
        inquiryId: options.requireActive
          ? sql`CASE WHEN ${activeInquiryExists(inquiryId)} THEN ${inquiryId} ELSE NULL END`
          : inquiryId,
        senderKind: 'user',
        body: message.body,
        createdAt: message.at,
      }),
      ...chunk(attachmentRows, ATTACHMENT_ROWS_PER_STATEMENT).map((rows) =>
        this.db.insert(inquiryMessageAttachments).values(rows),
      ),
    ];
  }
}
