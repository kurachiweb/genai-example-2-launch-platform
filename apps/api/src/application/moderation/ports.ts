import type { MinorUnitAmount } from '../../../common-lib/payments/money.ts';
import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import type { QuarantineReason } from '../../../lib/core/media/media-file.ts';
import type { NewModerationRecord } from '../../../lib/core/moderation/ports.ts';
import type { BusinessDate } from '../../../lib/core/time/business-time.ts';

export type ModerationIncident =
  | 'moderation-record-missing'
  | 'statistics-failed'
  | 'notice-redispatch-failed';

export interface ModerationIncidentContext {
  readonly job?: string;
  readonly count?: number;
}

// application層はエラートラッキングのSDKを読めないため、定型の通知をこのポート越しに送る
export interface ModerationIncidentReporter {
  report(
    incident: ModerationIncident,
    context: ModerationIncidentContext,
  ): void;
}

export interface ModerationOperator {
  readonly adminId: string;
}

// 呼び出し側の記録を措置と同じ一括の書き込みに入れるための値。kindはMODERATION_WRITE_PARTICIPANTSに登録した'<spec名>.<名詞句>'で、payloadは登録した参加者だけが解釈する(文・接続・関数を含めない)
export interface ModerationWriteParticipation<TPayload = unknown> {
  readonly kind: string;
  readonly payload: TPayload;
}

export interface ModerationCommand {
  readonly targetId: string;
  readonly reason: string | undefined;
  readonly operator: ModerationOperator;
  readonly at: Date;
  readonly participation?: ModerationWriteParticipation;
}

export interface ModerationOutcome {
  readonly changed: boolean;
  // changed: trueでnullなら、状態は変わったが保留中の措置を取り出せず、措置の記録・監査ログ・参加者の文が書かれていない。呼び出し側が参加者の記録を確定済みと扱わないよう区別する
  readonly actionId: string | null;
}

export interface ModerationRecordWrite {
  readonly record: NewModerationRecord;
  readonly audit: PreparedAuditEntry;
}

export interface ImageModerationWrite extends ModerationRecordWrite {
  readonly fileId: string;
}

export type ImageModerationChange = 'changed' | 'unchanged' | 'not-found';

// 理由の変更(または削除待ちの印)と記録と監査ログを同じ一括の書き込みで確定する。確定の後の移動の依頼・即時の削除の失敗はAppError(unavailable, storage_unavailable)で、状態と記録は確定したまま残る
export interface ImageModerationWriter {
  addReason(
    write: ImageModerationWrite,
    reason: QuarantineReason,
  ): Promise<ImageModerationChange>;
  removeReason(
    write: ImageModerationWrite,
    reason: QuarantineReason,
  ): Promise<ImageModerationChange>;
  requestErase(write: ImageModerationWrite): Promise<ImageModerationChange>;
}

export interface EngagementModerationWrite extends ModerationRecordWrite {
  readonly targetId: string;
  readonly at: Date;
  readonly participation?: ModerationWriteParticipation;
}

export type EngagementModerationChange = 'changed' | 'unchanged';

// コメント・評価の状態の変更と記録と監査ログと参加者の文を同じ一括の書き込みで確定する。上流がunchangedなら何も書かない。不在はAppError(not_found, comment_not_found・rating_not_found)
export interface EngagementModerationWriter {
  hideComment(
    write: EngagementModerationWrite,
  ): Promise<EngagementModerationChange>;
  unhideComment(
    write: EngagementModerationWrite,
  ): Promise<EngagementModerationChange>;
  invalidateRating(
    write: EngagementModerationWrite,
  ): Promise<EngagementModerationChange>;
  revalidateRating(
    write: EngagementModerationWrite,
  ): Promise<EngagementModerationChange>;
}

export interface WeeklyStatisticsRow {
  readonly weekStart: BusinessDate;
  readonly netRevenue: MinorUnitAmount;
  readonly usersTotal: number;
  readonly productsTotal: number;
  readonly qualifierMatches: number;
  readonly upvotes: number;
  readonly finalized: boolean;
  readonly computedAt: Date;
}

// 確定した週の値は変えない。listRecentは確定した週と、最も新しい週(未確定なら集計中の今週)を週の古い順に返し、ジョブが止まって確定できないまま後の週に追い越された週は値が週の途中のものであるため返さない
export interface WeeklyStatisticsStore {
  upsert(rows: readonly WeeklyStatisticsRow[]): Promise<void>;
  findFinalized(weekStart: BusinessDate): Promise<boolean>;
  listRecent(limit: number): Promise<readonly WeeklyStatisticsRow[]>;
}
