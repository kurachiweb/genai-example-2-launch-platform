import { and, eq, isNotNull, ne, or, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { inquiryMessageAttachments } from '../../../db/schema/inquiry/inquiry-message-attachments.ts';
import { inquiryMessages } from '../../../db/schema/inquiry/inquiry-messages.ts';
import { memberInquiries } from '../../../db/schema/inquiry/member-inquiries.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  FileReadPolicy,
  FileReadPolicyInput,
} from '../../application/media/file-access-policies.ts';

@injectable()
export class InquiryAttachmentReadPolicy implements FileReadPolicy {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  canRead({ principal, file }: FileReadPolicyInput): Promise<boolean> {
    if (principal.subjectKind === 'admin') {
      return this.isLinked(file.id);
    }
    if (file.owner.kind !== 'user' || file.owner.id !== principal.subjectId) {
      return Promise.resolve(false);
    }
    return this.isReadableByOwner(file.id, principal.subjectId);
  }

  // 管理者は退会済みの問い合わせの詳細も確かめるため、問い合わせの論理削除によらず紐付けの有無だけで判定する
  private async isLinked(fileId: string): Promise<boolean> {
    const rows = await this.db
      .select({ found: sql<number>`1` })
      .from(inquiryMessageAttachments)
      .where(eq(inquiryMessageAttachments.fileId, fileId))
      .limit(1);
    return rows.length > 0;
  }

  // 送信前に選んだ添付を本人が開けるよう紐付けの無いファイルは許し、紐付けが1つでも論理削除されていない本人の問い合わせ以外にあれば拒む
  private async isReadableByOwner(
    fileId: string,
    userId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ found: sql<number>`1` })
      .from(inquiryMessageAttachments)
      .innerJoin(
        inquiryMessages,
        eq(inquiryMessageAttachments.messageId, inquiryMessages.id),
      )
      .innerJoin(
        memberInquiries,
        eq(inquiryMessages.inquiryId, memberInquiries.id),
      )
      .where(
        and(
          eq(inquiryMessageAttachments.fileId, fileId),
          or(
            ne(memberInquiries.userId, userId),
            isNotNull(memberInquiries.deletedAt),
          ),
        ),
      )
      .limit(1);
    return rows.length === 0;
  }
}
