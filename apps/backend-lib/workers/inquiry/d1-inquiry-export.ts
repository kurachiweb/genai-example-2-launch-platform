import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { notDeleted } from '../../../db/schema/_shared/columns.ts';
import { inquiryCategories } from '../../../db/schema/inquiry/inquiry-categories.ts';
import { inquiryMessageAttachments } from '../../../db/schema/inquiry/inquiry-message-attachments.ts';
import { inquiryMessages } from '../../../db/schema/inquiry/inquiry-messages.ts';
import { memberInquiries } from '../../../db/schema/inquiry/member-inquiries.ts';
import { ADMIN_PLATFORM_TYPES } from '../../core/admin/identifiers.ts';
import type { AdminDirectory } from '../../core/admin/ports.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { invalidCursorError } from '../../core/errors/invalid-cursor.ts';
import {
  INQUIRY_EXPORT_PAGE_SIZE,
  type InquiryExport,
  type InquiryExportAttachment,
  type InquiryExportItem,
  type InquiryExportMessage,
  type InquiryExportPage,
} from '../../core/inquiry/ports.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import { MEDIA_TYPES } from '../../core/media/identifiers.ts';
import type { MediaFileView } from '../../core/media/media-file.ts';
import type { MediaFiles } from '../../core/media/ports.ts';

const INQUIRY_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

// データエクスポートはイベントサーバーのQueueの処理だけが呼ぶ
const logger = getAppLogger(['event', 'inquiry', 'export']);

interface InquiryRow {
  readonly id: string;
  readonly category: string;
  readonly status: InquiryExportItem['status'];
  readonly createdAt: Date;
}

interface MessageRow {
  readonly id: string;
  readonly inquiryId: string;
  readonly senderKind: InquiryExportMessage['sender'];
  readonly adminId: string | null;
  readonly body: string;
  readonly createdAt: Date;
}

interface AttachmentRow {
  readonly messageId: string;
  readonly fileId: string;
}

function afterInquiry(after: string | undefined) {
  if (after === undefined) {
    return undefined;
  }
  if (!INQUIRY_ID_PATTERN.test(after)) {
    throw invalidCursorError();
  }
  return gt(memberInquiries.id, after);
}

function attachmentOf(file: MediaFileView): InquiryExportAttachment {
  return {
    fileId: file.id,
    originalFileName: file.originalFileName,
    contentType: file.contentType,
    size: file.byteSize,
  };
}

@injectable()
export class D1InquiryExport implements InquiryExport {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(ADMIN_PLATFORM_TYPES.AdminDirectory)
    private readonly admins: AdminDirectory,
    @inject(MEDIA_TYPES.MediaFiles) private readonly files: MediaFiles,
  ) {}

  async listPage(
    userId: string,
    after: string | undefined,
  ): Promise<InquiryExportPage> {
    const rows = await this.db
      .select({
        id: memberInquiries.id,
        category: inquiryCategories.name,
        status: memberInquiries.status,
        createdAt: memberInquiries.createdAt,
      })
      .from(memberInquiries)
      .innerJoin(
        inquiryCategories,
        eq(inquiryCategories.id, memberInquiries.categoryId),
      )
      .where(
        and(
          eq(memberInquiries.userId, userId),
          notDeleted(memberInquiries.deletedAt),
          afterInquiry(after),
        ),
      )
      .orderBy(asc(memberInquiries.id))
      .limit(INQUIRY_EXPORT_PAGE_SIZE + 1);
    const inquiries = rows.slice(0, INQUIRY_EXPORT_PAGE_SIZE);
    const items = await this.itemsOf(inquiries);
    return {
      items,
      nextCursor:
        rows.length > INQUIRY_EXPORT_PAGE_SIZE
          ? (inquiries.at(-1)?.id ?? null)
          : null,
    };
  }

  private async itemsOf(
    inquiries: readonly InquiryRow[],
  ): Promise<InquiryExportItem[]> {
    if (inquiries.length === 0) {
      return [];
    }
    const { messages, attachments } = await this.readMessages(
      inquiries.map((inquiry) => inquiry.id),
    );
    const adminIds = messages.flatMap((message) =>
      message.adminId === null ? [] : [message.adminId],
    );
    const [profiles, files] = await Promise.all([
      this.admins.findProfiles(adminIds),
      this.findFiles(attachments.map((attachment) => attachment.fileId)),
    ]);
    const attachmentsOf = Map.groupBy(attachments, (row) => row.messageId);
    const messagesOf = Map.groupBy(messages, (row) => row.inquiryId);
    return inquiries.map((inquiry) => ({
      id: inquiry.id,
      category: inquiry.category,
      status: inquiry.status,
      createdAt: inquiry.createdAt.toISOString(),
      messages: (messagesOf.get(inquiry.id) ?? []).map((message) => ({
        id: message.id,
        sender: message.senderKind,
        adminNickname:
          message.adminId === null
            ? null
            : (profiles.get(message.adminId)?.nickname ?? null),
        body: message.body,
        attachments: (attachmentsOf.get(message.id) ?? []).flatMap((row) => {
          const file = files.get(row.fileId);
          return file === undefined ? [] : [attachmentOf(file)];
        }),
        createdAt: message.createdAt.toISOString(),
      })),
    }));
  }

  // 1ページの問い合わせのIDは20個のため、D1のバインド変数の上限(100)に収まる。メッセージと添付を同じ時点の状態で読むため1回の一括で読む
  private async readMessages(inquiryIds: readonly string[]): Promise<{
    readonly messages: readonly MessageRow[];
    readonly attachments: readonly AttachmentRow[];
  }> {
    const [messages, attachments] = await this.db.batch([
      this.db
        .select({
          id: inquiryMessages.id,
          inquiryId: inquiryMessages.inquiryId,
          senderKind: inquiryMessages.senderKind,
          adminId: inquiryMessages.adminId,
          body: inquiryMessages.body,
          createdAt: inquiryMessages.createdAt,
        })
        .from(inquiryMessages)
        .where(inArray(inquiryMessages.inquiryId, inquiryIds))
        .orderBy(
          asc(inquiryMessages.inquiryId),
          asc(inquiryMessages.createdAt),
          asc(inquiryMessages.id),
        ),
      // 管理者の返信は添付を受け付けないため、利用者のメッセージの添付だけを返す
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
        .where(
          and(
            inArray(inquiryMessages.inquiryId, inquiryIds),
            eq(inquiryMessages.senderKind, 'user').inlineParams(),
          ),
        )
        .orderBy(
          asc(inquiryMessageAttachments.messageId),
          asc(inquiryMessageAttachments.position),
        ),
    ]);
    return { messages, attachments };
  }

  private async findFiles(
    fileIds: readonly string[],
  ): Promise<ReadonlyMap<string, MediaFileView>> {
    if (fileIds.length === 0) {
      return new Map();
    }
    const files = await this.files.findMany(fileIds);
    const missingFileIds = fileIds.filter((fileId) => !files.has(fileId));
    if (missingFileIds.length > 0) {
      logger.warn(
        'データエクスポートで物理削除済みのファイルの添付を除きました',
        {
          missingFileCount: missingFileIds.length,
          missingFileIds,
        },
      );
    }
    return files;
  }
}
