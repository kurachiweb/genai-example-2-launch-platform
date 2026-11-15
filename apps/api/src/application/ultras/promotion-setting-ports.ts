import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';

export interface PromotionSettingRecord {
  readonly id: string;
  readonly enabled: boolean;
  readonly version: number;
  readonly updatedAt: Date;
  // 管理者がまだ変更していない初期行はnull。削除済みの管理者のIDはそのまま残る
  readonly updatedByAdminId: string | null;
}

export interface PromotionSettingReader {
  // 鍵の行が無ければundefined
  read(): Promise<PromotionSettingRecord | undefined>;
}

export interface PromotionSettingUpdate {
  readonly enabled: boolean;
  readonly expectedVersion: number;
  readonly adminId: string;
  readonly now: Date;
}

export interface PromotionSettingWriter {
  // 読み取った版のままの行があるときだけ、監査ログと同じ一括の書き込みで値・版(+1)・変更した管理者・更新日時を書く。
  // 一致しなければAppError(conflict, version_conflict)
  write(
    update: PromotionSettingUpdate,
    audit: PreparedAuditEntry,
  ): Promise<void>;
}
