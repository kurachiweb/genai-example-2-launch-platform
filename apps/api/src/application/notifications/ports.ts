import type { NoticeSuppressionReason } from '../../../lib/core/notifications/notice-copy.ts';

export type DeliveryStatus =
  | { readonly kind: 'deliverable' }
  | {
      readonly kind: 'suppressed';
      readonly reason: NoticeSuppressionReason;
      readonly until: Date | null;
    }
  | { readonly kind: 'unknown' };

export interface DeliveryStatusReader {
  // 連絡先が無い・照会に失敗した場合はunknown
  statusOf(userId: string): Promise<DeliveryStatus>;
}
