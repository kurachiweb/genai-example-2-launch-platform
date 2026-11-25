import { and, eq, lt, or } from 'drizzle-orm';

import type { Database } from '../../../db/client.ts';
import { emailSendRecords } from '../../../db/schema/email/email-send-records.ts';
import type { SendRecordStore } from '../../core/email/ports.ts';

export interface SendRecordRepository extends SendRecordStore {
  deleteSentBefore(cutoff: Date): Promise<number>;
}

export function createSendRecordRepository(db: Database): SendRecordRepository {
  return {
    async hasSent(requestId, idempotency) {
      const sameRequest = eq(emailSendRecords.id, requestId);
      const [row] = await db
        .select({ id: emailSendRecords.id })
        .from(emailSendRecords)
        .where(
          idempotency === undefined
            ? sameRequest
            : or(
                sameRequest,
                and(
                  eq(emailSendRecords.kind, idempotency.kind),
                  eq(emailSendRecords.idempotencyKey, idempotency.key),
                ),
              ),
        )
        .limit(1);
      return row !== undefined;
    },

    async markSent(requestId, kind, sentAt, idempotencyKey) {
      // 重複配信の判定に使うため、主キーは採番させず送信要求の識別子をそのまま入れる
      // 識別子と、種別と冪等のキーの組のどちらが重なっても先の記録を残すため、競合の対象を絞らない
      await db
        .insert(emailSendRecords)
        .values({
          id: requestId,
          kind,
          idempotencyKey: idempotencyKey ?? null,
          sentAt,
          createdAt: sentAt,
          updatedAt: sentAt,
        })
        .onConflictDoNothing();
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
