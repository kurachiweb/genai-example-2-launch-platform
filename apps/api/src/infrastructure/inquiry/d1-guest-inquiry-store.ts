import { and, asc, inArray, lte } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { guestInquiries } from '../../../db/schema/inquiry/guest-inquiries.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  GuestInquiryStore,
  NewGuestInquiry,
} from '../../application/inquiry/ports.ts';
import { categoryReferenceFailureOf } from './category-reference-failure.ts';

const CLOSED_STATUSES = ['resolved', 'rejected'] as const;

@injectable()
export class D1GuestInquiryStore implements GuestInquiryStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  // ステータスは列の既定値の未対応にし、受付日時をステータスの変更日時にする
  async insert(inquiry: NewGuestInquiry): Promise<void> {
    try {
      await this.db.insert(guestInquiries).values({
        id: inquiry.id,
        categoryId: inquiry.categoryId,
        nickname: inquiry.nickname,
        email: inquiry.email,
        body: inquiry.body,
        statusChangedAt: inquiry.at,
        createdAt: inquiry.at,
        updatedAt: inquiry.at,
      });
    } catch (error) {
      throw categoryReferenceFailureOf(error);
    }
  }

  // 未ログインの問い合わせは添付もメッセージの行も持たないため、問い合わせの行だけを消す
  async deleteClosedBefore(threshold: Date, limit: number): Promise<number> {
    const expiredIds = this.db
      .select({ id: guestInquiries.id })
      .from(guestInquiries)
      .where(
        and(
          inArray(guestInquiries.status, CLOSED_STATUSES),
          lte(guestInquiries.statusChangedAt, threshold),
        ),
      )
      .orderBy(asc(guestInquiries.statusChangedAt), asc(guestInquiries.id))
      .limit(limit);
    const result = await this.db
      .delete(guestInquiries)
      .where(inArray(guestInquiries.id, expiredIds));
    return result.meta.changes;
  }
}
