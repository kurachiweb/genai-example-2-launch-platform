import { eq, lt } from 'drizzle-orm';

import type { Database } from '../../../db/client.ts';
import { emailSendRecords } from '../../../db/schema/email/email-send-records.ts';
import type { SendRecordStore } from '../../core/email/ports.ts';

export interface SendRecordRepository extends SendRecordStore {
  deleteSentBefore(cutoff: Date): Promise<number>;
}

export function createSendRecordRepository(db: Database): SendRecordRepository {
  return {
    async hasSent(requestId) {
      const [row] = await db
        .select({ id: emailSendRecords.id })
        .from(emailSendRecords)
        .where(eq(emailSendRecords.id, requestId))
        .limit(1);
      return row !== undefined;
    },

    async markSent(requestId, kind, sentAt) {
      // 重複配信の判定に使うため、主キーは採番させず送信要求の識別子をそのまま入れる
      await db
        .insert(emailSendRecords)
        .values({
          id: requestId,
          kind,
          sentAt,
          createdAt: sentAt,
          updatedAt: sentAt,
        })
        .onConflictDoNothing({ target: emailSendRecords.id });
    },

    async deleteSentBefore(cutoff) {
      const deleted = await db
        .delete(emailSendRecords)
        .where(lt(emailSendRecords.sentAt, cutoff))
        .returning({ id: emailSendRecords.id });
      return deleted.length;
    },
  };
}
