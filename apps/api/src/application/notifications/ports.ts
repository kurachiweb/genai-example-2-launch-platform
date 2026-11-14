import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import type { SenderInfo } from '../../../lib/core/email/ports.ts';
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

export interface SenderInfoSave {
  readonly info: SenderInfo;
  // 未設定は0
  readonly expectedVersion: number;
  readonly adminId: string;
  readonly audit: PreparedAuditEntry;
  readonly at: Date;
}

export interface SenderInfoWriter {
  // 読み取った版のままの設定の行があるときだけ、監査ログと同じ一括の書き込みで3項目・版(+1)・変更した管理者・更新日時を書く。行を挿入しない
  save(input: SenderInfoSave): Promise<'saved' | 'version_conflict'>;
}
