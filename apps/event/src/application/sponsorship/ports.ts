import type {
  RefundOutcome,
  SponsorshipRecord,
} from '../../../lib/core/sponsorship/ports.ts';

export type SponsorshipNoticeKind = 'start' | 'end' | 'termination';

export interface PendingSponsorshipNotice {
  readonly sponsorshipId: string;
  readonly kind: SponsorshipNoticeKind;
}

// SponsorshipRecordは申込の論理削除を表せないため、論理削除された申込の通知は記録を返さずに区別する
export type SponsorshipNoticeClaim =
  | { readonly kind: 'claimed'; readonly record: SponsorshipRecord }
  | { readonly kind: 'deleted' };

export interface NoticeClaimStore {
  // 論理削除・強制終了の申込を含む全ての依頼待ちを、依頼待ちになった時刻の順に
  listPending(limit: number): Promise<readonly PendingSponsorshipNotice[]>;
  // 依頼待ちから依頼済みへの条件付きの更新。他の処理が先に取った・依頼待ちでないならundefined。取った後に失敗したら依頼待ちに戻してから例外を投げるため、呼び出し側は戻さない
  claim(
    notice: PendingSponsorshipNotice,
    at: Date,
  ): Promise<SponsorshipNoticeClaim | undefined>;
  // 依頼済みから送らない(skipped)へ
  markSkipped(notice: PendingSponsorshipNotice, at: Date): Promise<void>;
  // 一時的な失敗で、依頼済みから依頼待ちへ戻す
  release(notice: PendingSponsorshipNotice, at: Date): Promise<void>;
}

export type PeriodEndSettlementResult =
  | { readonly kind: 'settled'; readonly displayStop: RefundOutcome }
  // 条件の崩れ(同時の精算を含む)で一括の書き込みが取り消された
  | { readonly kind: 'skipped' };

export interface PeriodEndSettlementCommitter {
  // 返金の拒否以外の例外はそのまま投げる
  settle(
    record: SponsorshipRecord,
    at: Date,
  ): Promise<PeriodEndSettlementResult>;
}

export interface SponsorshipPurgeStore {
  // 申込の行と利用者の表示停止の区間
  purgeByUser(userId: string): Promise<void>;
  // 申込の行とプロダクトの表示停止の区間
  purgeByProduct(productId: string): Promise<void>;
}
