import { inject, injectable } from 'inversify';

import { SPONSORSHIP_TERMINATE_ACTION } from '../../../common-lib/admin/audit-actions/sponsorship.ts';
import { isTerminable } from '../../../common-lib/sponsorship/sponsorship-status.ts';
import type {
  AuditLogRecorder,
  PreparedAuditEntry,
} from '../../../lib/core/admin/audit-log.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { SPONSORSHIP_PLATFORM_TYPES } from '../../../lib/core/sponsorship/identifiers.ts';
import type {
  NoticeRequester,
  RefundEstimator,
  RefundOutcome,
  RefundStatus,
  SponsorshipRecord,
  SponsorshipStore,
  TerminationEstimate,
} from '../../../lib/core/sponsorship/ports.ts';
import {
  type BusinessDate,
  toBusinessDateTime,
} from '../../../lib/core/time/business-time.ts';
import type { AdminRoleRequirement } from './admin-sponsorships-reader.ts';
import { sponsorshipError } from './sponsorship-errors.ts';
import { SPONSORSHIP_TYPES } from './sponsorship-types.ts';

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

export interface TerminationPreview extends TerminationEstimate {
  readonly sponsorshipId: string;
  readonly days: number;
  readonly amountTotal: number;
}

export interface TerminationResult extends TerminationPreview {
  readonly terminatedOn: BusinessDate;
  readonly purchaseId: string;
  readonly terminationRefundStatus: RefundStatus;
  readonly stopRefundStatus: RefundStatus;
  // 依頼した額。残りの全額で依頼したとき・依頼しなかったときはnull
  readonly terminationRefundRequested: number | null;
  readonly stopRefundRequested: number | null;
}

interface TerminationTarget {
  readonly sponsorshipId: string;
  readonly now: Date;
  readonly requireRole: AdminRoleRequirement;
}

export interface SponsorshipTermination {
  // 決済の機能を呼ばずに見積もる
  preview(input: TerminationTarget): Promise<TerminationPreview>;
  // 理由の空・上限の超過はAppError(bad_request, validation_error)、強制終了できない申込はAppError(conflict, sponsorship_not_terminable)
  terminate(
    input: TerminationTarget & { readonly reason: string },
  ): Promise<TerminationResult>;
}

interface PaidSponsorship {
  readonly record: SponsorshipRecord;
  readonly purchaseId: string;
  readonly amountTotal: number;
}

const logger = getAppLogger(['api', 'application', 'sponsorship']);

const requestedAmountOf = (outcome: RefundOutcome): number | null =>
  outcome.status === 'requested' ? outcome.amount : null;

// 決済済みの購入ID・金額はデータベースの検査制約が保証するため、欠けていれば強制終了できない申込でなく不整合として失敗させる
function paidSponsorshipOf(record: SponsorshipRecord): PaidSponsorship {
  if (record.purchaseId === null || record.amountTotal === null) {
    throw new Error(
      `決済済みの申込に購入IDか支払った金額がありません: ${record.id}`,
    );
  }
  return {
    record,
    purchaseId: record.purchaseId,
    amountTotal: record.amountTotal,
  };
}

@injectable()
export class DefaultSponsorshipTermination implements SponsorshipTermination {
  constructor(
    @inject(SPONSORSHIP_PLATFORM_TYPES.SponsorshipStore)
    private readonly store: SponsorshipStore,
    @inject(SPONSORSHIP_PLATFORM_TYPES.RefundEstimator)
    private readonly estimator: RefundEstimator,
    @inject(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
    private readonly auditLog: AuditLogRecorder,
    @inject(SPONSORSHIP_TYPES.SponsorshipTerminationWriter)
    private readonly writer: SponsorshipTerminationWriter,
    @inject(SPONSORSHIP_PLATFORM_TYPES.NoticeRequester)
    private readonly notices: NoticeRequester,
  ) {}

  async preview(input: TerminationTarget): Promise<TerminationPreview> {
    await input.requireRole('moderator');
    const today = toBusinessDateTime(input.now).date;
    const paid = await this.#terminableOf(input.sponsorshipId, today);
    return this.#previewOf(paid, today);
  }

  async terminate(
    input: TerminationTarget & { readonly reason: string },
  ): Promise<TerminationResult> {
    const admin = await input.requireRole('moderator');
    const today = toBusinessDateTime(input.now).date;
    const paid = await this.#terminableOf(input.sponsorshipId, today);
    const preview = await this.#previewOf(paid, today);
    const audit = this.auditLog.prepare({
      operatorAdminId: admin.id,
      action: SPONSORSHIP_TERMINATE_ACTION.name,
      targetIds: [paid.record.id],
      reason: input.reason,
      detail: {
        unexposedDays: String(preview.unexposedDays),
        refundEstimate: String(preview.refundEstimate),
        stoppedDays: String(preview.stoppedDays),
        stopRefundAmount: String(preview.stopRefundAmount),
      },
      occurredAt: input.now,
    });
    const result = await this.writer.commit({
      record: paid.record,
      today,
      // 監査ログと申込に同じ理由を残すため、prepareが前後の空白を除いた理由を保存する
      reason: audit.reason ?? '',
      at: input.now,
      audit,
    });
    if (result.kind === 'not_terminable') {
      throw sponsorshipError('sponsorship_not_terminable');
    }
    await this.#requestNotice(paid.record.id);
    return {
      ...preview,
      terminatedOn: today,
      purchaseId: paid.purchaseId,
      terminationRefundStatus: result.termination.status,
      stopRefundStatus: result.displayStop.status,
      terminationRefundRequested: requestedAmountOf(result.termination),
      stopRefundRequested: requestedAmountOf(result.displayStop),
    };
  }

  async #terminableOf(
    sponsorshipId: string,
    today: BusinessDate,
  ): Promise<PaidSponsorship> {
    const record = await this.store.findById(sponsorshipId);
    // 管理画面の一覧のterminableと同じく、プロダクトの論理削除は申込の列で判定する
    if (
      record === undefined ||
      !isTerminable({
        state: record.state,
        endsOn: record.endsOn,
        product: record.productDeletedAt === null ? 'visible' : 'deleted',
        today,
      })
    ) {
      throw sponsorshipError('sponsorship_not_terminable');
    }
    return paidSponsorshipOf(record);
  }

  async #previewOf(
    paid: PaidSponsorship,
    today: BusinessDate,
  ): Promise<TerminationPreview> {
    const estimate = await this.estimator.estimateTermination(
      paid.record,
      today,
    );
    return {
      sponsorshipId: paid.record.id,
      days: paid.record.days,
      amountTotal: paid.amountTotal,
      unexposedDays: estimate.unexposedDays,
      refundEstimate: estimate.refundEstimate,
      stoppedDays: estimate.stoppedDays,
      stopRefundAmount: estimate.stopRefundAmount,
    };
  }

  // 通知は確定と同じ書き込みで依頼待ちとして記録したため、送れなかった依頼は日次の処理が補う
  async #requestNotice(sponsorshipId: string): Promise<void> {
    try {
      await this.notices.request();
    } catch (error: unknown) {
      logger.warning('強制終了の通知の送信を依頼できませんでした', {
        sponsorshipId,
        error,
      });
    }
  }
}
