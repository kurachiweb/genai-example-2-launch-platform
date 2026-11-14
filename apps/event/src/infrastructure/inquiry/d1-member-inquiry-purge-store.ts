import { asc, eq, type SQL, sql } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { inquiryMessageAttachments } from '../../../db/schema/inquiry/inquiry-message-attachments.ts';
import { inquiryMessages } from '../../../db/schema/inquiry/inquiry-messages.ts';
import { memberInquiries } from '../../../db/schema/inquiry/member-inquiries.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  MemberInquiryPurgeBatchResult,
  MemberInquiryPurgeStore,
} from '../../application/inquiry/ports.ts';

// 件数によらずバインド変数を1つに収めるため、IDの一覧をJSONの文字列で渡して展開する
function inIds(column: SQLiteColumn, ids: readonly string[]): SQL {
  return sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`;
}

@injectable()
export class D1MemberInquiryPurgeStore implements MemberInquiryPurgeStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  // 外部キーにON DELETEの動作を指定していないため、添付の紐付け・メッセージ・問い合わせの順に消す
  async purgeBatch(
    userId: string,
    limit: number,
  ): Promise<MemberInquiryPurgeBatchResult> {
    const rows = await this.db
      .select({ id: memberInquiries.id })
      .from(memberInquiries)
      .where(eq(memberInquiries.userId, userId))
      .orderBy(asc(memberInquiries.id))
      .limit(limit + 1);
    const ids = rows.slice(0, limit).map((row) => row.id);
    if (ids.length === 0) {
      return { hasMore: false };
    }
    const messageIds = this.db
      .select({ id: inquiryMessages.id })
      .from(inquiryMessages)
      .where(inIds(inquiryMessages.inquiryId, ids));
    await this.db.batch([
      this.db
        .delete(inquiryMessageAttachments)
        .where(sql`${inquiryMessageAttachments.messageId} IN ${messageIds}`),
      this.db
        .delete(inquiryMessages)
        .where(inIds(inquiryMessages.inquiryId, ids)),
      this.db.delete(memberInquiries).where(inIds(memberInquiries.id, ids)),
    ]);
    return { hasMore: rows.length > limit };
  }
}
