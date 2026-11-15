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

export interface StalePendingEvent {
  readonly eventId: string;
  // 発行の時点を1回目として、これまでに展開を依頼した回数
  readonly dispatchCount: number;
}

export interface NotificationMaintenanceStore {
  // 送信枠の期日がdueBeforeより前の未送信の通知を、送らない扱い(期限切れ)にして件数を返す
  expirePending(dueBefore: Date, at: Date): Promise<number>;
  // 最後に展開を依頼した日時がdispatchedBeforeより前で、展開を終えていない通知イベントを古い順に返す
  listStalePendingEvents(
    dispatchedBefore: Date,
    limit: number,
  ): Promise<readonly StalePendingEvent[]>;
  // 展開を終えていない通知イベントだけ、依頼の回数を1つ進めて最後に依頼した日時をatにする
  markEventsRedispatched(eventIds: readonly string[], at: Date): Promise<void>;
  // 以下の削除は条件に合う行を古い順にlimit件まで消し、消した件数を返す
  deleteSettledBefore(cutoff: Date, limit: number): Promise<number>;
  // 未送信の通知が残る枠は消さない。枠の準備の完了の記録も同じ一括の書き込みで消す
  deleteCompletedSlotsBefore(cutoff: Date, limit: number): Promise<number>;
  deleteExpandedEventsBefore(cutoff: Date, limit: number): Promise<number>;
  // 作成がcutoffより前で展開を終えていない通知イベントを、送らずに消す
  deletePendingEventsCreatedBefore(
    cutoff: Date,
    limit: number,
  ): Promise<number>;
}
