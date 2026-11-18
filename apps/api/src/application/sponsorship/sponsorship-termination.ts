import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import type {
  RefundOutcome,
  SponsorshipRecord,
} from '../../../lib/core/sponsorship/ports.ts';
import type { BusinessDate } from '../../../lib/core/time/business-time.ts';

export type TerminationCommitResult =
  | {
      readonly kind: 'committed';
      // 未掲載日数分
      readonly termination: RefundOutcome;
      // 強制終了日の前日までの表示停止日数分
      readonly displayStop: RefundOutcome;
    }
  | { readonly kind: 'not_terminable' };

// 返金の計画の文・決済の機能の口・データベースの接続をapplication層へ持ち込まないよう、計画から確定の後の依頼の送信までを1つのポートに閉じる
export interface SponsorshipTerminationWriter {
  commit(input: {
    readonly record: SponsorshipRecord;
    readonly today: BusinessDate;
    readonly reason: string;
    readonly at: Date;
    readonly audit: PreparedAuditEntry;
  }): Promise<TerminationCommitResult>;
}
