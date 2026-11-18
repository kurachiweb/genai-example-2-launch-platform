import type { Logger } from '@logtape/logtape';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';

import {
  computeRefundEstimate,
  computeUnexposedDays,
  countStoppedDays,
  type DisplayStopDates,
} from '../../../common-lib/sponsorship/refund-estimate.ts';
import type { Database } from '../../../db/client.ts';
import { sponsorships } from '../../../db/schema/sponsorship/sponsorships.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import type { PaymentRefunds } from '../../core/payments/ports.ts';
import {
  type RefundRejectionCode,
  type RefundRejectionOutcome,
  refundRejectionOutcome,
} from '../../core/payments/refund-rejection.ts';
import {
  type DisplayStopInterval,
  type DisplayStopStore,
  type RefundEstimator,
  type RefundKind,
  type RefundOutcome,
  SPONSORSHIP_REFUND_REASONS,
  type SponsorshipRecord,
  type TerminationEstimate,
} from '../../core/sponsorship/ports.ts';
import {
  addBusinessDays,
  type BusinessDate,
  fromBusinessDateTime,
  toBusinessDateTime,
} from '../../core/time/business-time.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import type { PaymentRefundStatements } from '../payments/statement-contracts.ts';
import {
  reportSponsorshipIncident,
  type SponsorshipIncidentReport,
} from './sponsorship-incident-reporting.ts';

type SponsorshipRefundReason =
  (typeof SPONSORSHIP_REFUND_REASONS)[keyof typeof SPONSORSHIP_REFUND_REASONS];

export type RefundIncident = Pick<
  SponsorshipIncidentReport,
  'incident' | 'sponsorshipId' | 'code'
>;

export interface RefundPlan extends RefundOutcome {
  // PaymentRefundStatements.prepareが返した文
  readonly statements: readonly BatchItem<'sqlite'>[];
  // 確定の後にdispatchが運営者へ知らせる異常
  readonly incident: RefundIncident | null;
}

export interface TerminationPlans {
  // 未掲載日数分
  readonly termination: RefundPlan;
  // 強制終了日の前日までの表示停止日数分
  readonly displayStop: RefundPlan;
}

// 返金の計画と申込の列の更新の文を返す。apiの強制終了の書き込みとeventの掲載の終わりの精算の書き込みのinfrastructure層だけが使う
export interface RefundSettlement {
  planTermination(
    record: SponsorshipRecord,
    today: BusinessDate,
  ): Promise<TerminationPlans>;
  // 掲載終了日までの表示停止日数分
  planPeriodEnd(record: SponsorshipRecord): Promise<RefundPlan>;
  // 決済済み・論理削除なし・プロダクトの論理削除なし・表示停止の返金が未精算でなければ、状態をNULLにしてNOT NULLの違反で一括の書き込み全体を取り消す
  periodEndStatement(
    record: SponsorshipRecord,
    plan: RefundPlan,
    at: Date,
    db: Database,
  ): BatchItem<'sqlite'>;
  // 確定の後に全ての計画を渡す。依頼済みの依頼を送り(失敗は警告のログだけ)、返金済み・拒否を運営者へ知らせる
  dispatch(plans: readonly RefundPlan[]): Promise<void>;
}

export interface D1RefundSettlementDependencies {
  readonly appName: LoggingOptions['appName'];
  readonly displayStops: DisplayStopStore;
  readonly refundStatements: PaymentRefundStatements;
  readonly refunds: PaymentRefunds;
}

interface RefundFigures {
  readonly days: number;
  readonly amount: number;
}

interface TerminationFigures {
  readonly termination: RefundFigures;
  readonly displayStop: RefundFigures;
}

type RejectionCause = RefundRejectionCode | 'invalid_reason';

type PrepareResult =
  | {
      readonly kind: 'accepted';
      readonly refundRequestId: string;
      readonly statements: readonly BatchItem<'sqlite'>[];
    }
  | { readonly kind: 'rejected'; readonly cause: RejectionCause };

const START_OF_DAY = Object.freeze({ hour: 0, minute: 0 });

const REASONS: Readonly<Record<RefundKind, SponsorshipRefundReason>> =
  Object.freeze({
    termination: SPONSORSHIP_REFUND_REASONS.termination,
    display_stop: SPONSORSHIP_REFUND_REASONS.displayStop,
  });

export function sponsorshipRefundRequestKey(
  purchaseId: string,
  reason: SponsorshipRefundReason,
): string {
  return `sponsorship:${purchaseId}:${reason}`;
}

export function refundOutcomeOf(plan: RefundPlan): RefundOutcome {
  return {
    kind: plan.kind,
    days: plan.days,
    amount: plan.amount,
    status: plan.status,
    refundRequestId: plan.refundRequestId,
  };
}

const startOf = (date: BusinessDate): Date =>
  fromBusinessDateTime(date, START_OF_DAY);

const earlierOf = (a: BusinessDate, b: BusinessDate): BusinessDate =>
  a < b ? a : b;

// 区間の最後の瞬間を含む日まで数えるため、終わりの1ミリ秒前の日付にする(0:00ちょうどの終わりは前日)
function datesOf(
  intervals: readonly DisplayStopInterval[],
): DisplayStopDates[] {
  return intervals.flatMap(({ startedAt, endedAt }) => {
    if (endedAt !== null && endedAt <= startedAt) {
      return [];
    }
    return [
      {
        fromDate: toBusinessDateTime(startedAt).date,
        toDate:
          endedAt === null
            ? null
            : toBusinessDateTime(new Date(endedAt.getTime() - 1)).date,
      },
    ];
  });
}

function amountOf(record: SponsorshipRecord, days: number): number {
  return computeRefundEstimate({
    amountTotal: record.amountTotal ?? 0,
    days: record.days,
    unexposedDays: days,
  });
}

const INVALID_REASON_OUTCOME: RefundRejectionOutcome = Object.freeze({
  refundStatus: 'rejected',
  report: true,
});

// 拒否の原因から返金の状態を決め、返金済み・拒否には確定の後に知らせる異常を添える
function closedPlan(
  record: SponsorshipRecord,
  kind: RefundKind,
  figures: RefundFigures,
  cause: RejectionCause,
): RefundPlan {
  const { refundStatus, report } =
    cause === 'invalid_reason'
      ? INVALID_REASON_OUTCOME
      : refundRejectionOutcome(cause);
  return {
    kind,
    days: figures.days,
    amount: figures.amount,
    status: refundStatus,
    refundRequestId: null,
    statements: [],
    incident: report
      ? {
          incident:
            refundStatus === 'already_refunded'
              ? 'refund-already-settled'
              : 'refund-rejected',
          sponsorshipId: record.id,
          code: cause,
        }
      : null,
  };
}

function notNeeded(kind: RefundKind, figures: RefundFigures): RefundPlan {
  return {
    kind,
    days: figures.days,
    amount: figures.amount,
    status: 'not_needed',
    refundRequestId: null,
    statements: [],
    incident: null,
  };
}

// 残りの全額の依頼か返金済みで、確定前の表示停止の依頼に使える残りが無い
function exhaustsRefundable(plan: RefundPlan): boolean {
  return (
    (plan.status === 'requested' && plan.amount === null) ||
    plan.status === 'already_refunded'
  );
}

export class D1RefundSettlement implements RefundSettlement, RefundEstimator {
  private readonly appName: LoggingOptions['appName'];
  private readonly displayStops: DisplayStopStore;
  private readonly refundStatements: PaymentRefundStatements;
  private readonly refunds: PaymentRefunds;
  private readonly logger: Logger;

  constructor(dependencies: D1RefundSettlementDependencies) {
    this.appName = dependencies.appName;
    this.displayStops = dependencies.displayStops;
    this.refundStatements = dependencies.refundStatements;
    this.refunds = dependencies.refunds;
    this.logger = getAppLogger([dependencies.appName, 'sponsorship', 'refund']);
  }

  async estimateTermination(
    record: SponsorshipRecord,
    today: BusinessDate,
  ): Promise<TerminationEstimate> {
    const figures = await this.terminationFiguresOf(record, today);
    return {
      unexposedDays: figures.termination.days,
      refundEstimate: figures.termination.amount,
      stoppedDays: figures.displayStop.days,
      stopRefundAmount: figures.displayStop.amount,
    };
  }

  async planTermination(
    record: SponsorshipRecord,
    today: BusinessDate,
  ): Promise<TerminationPlans> {
    const figures = await this.terminationFiguresOf(record, today);
    // 表示停止のprepareは確定前の強制終了の依頼を残りの額に数えないため、強制終了の依頼を先に作る
    const termination = await this.planRefund(
      record,
      'termination',
      figures.termination,
    );
    // 返金額0とプロダクトの論理削除の返金不要を優先する。残りの全額の依頼と同じ一括の書き込みに表示停止の依頼を加えると、決済サービスで失敗する二重の依頼になるため依頼しない
    const displayStop =
      exhaustsRefundable(termination) &&
      figures.displayStop.amount > 0 &&
      record.productDeletedAt === null
        ? closedPlan(
            record,
            'display_stop',
            figures.displayStop,
            'amount_exceeds_refundable',
          )
        : await this.planDisplayStop(record, figures.displayStop);
    return { termination, displayStop };
  }

  async planPeriodEnd(record: SponsorshipRecord): Promise<RefundPlan> {
    const days = await this.stoppedDaysOf(record, record.endsOn);
    return this.planDisplayStop(record, {
      days,
      amount: amountOf(record, days),
    });
  }

  periodEndStatement(
    record: SponsorshipRecord,
    plan: RefundPlan,
    at: Date,
    db: Database,
  ): BatchItem<'sqlite'> {
    const unsettled = and(
      eq(sponsorships.state, 'paid'),
      isNull(sponsorships.deletedAt),
      isNull(sponsorships.productDeletedAt),
      eq(sponsorships.stopRefundStatus, 'none'),
    );
    return db
      .update(sponsorships)
      .set({
        stopRefundStatus: sql<
          RefundPlan['status']
        >`case when ${unsettled} then ${plan.status} else null end`,
        stopRefundDays: plan.days,
        stopRefundAmount: plan.amount,
        stopRefundRequestId: plan.refundRequestId,
        updatedAt: at,
      })
      .where(eq(sponsorships.id, record.id));
  }

  async dispatch(plans: readonly RefundPlan[]): Promise<void> {
    for (const plan of plans) {
      if (plan.incident !== null) {
        reportSponsorshipIncident({
          appName: this.appName,
          refundKind: plan.kind,
          ...plan.incident,
        });
      }
      if (plan.status !== 'requested' || plan.refundRequestId === null) {
        continue;
      }
      try {
        await this.refunds.dispatch(plan.refundRequestId);
      } catch (error) {
        // 送信の日時が空の依頼は決済の機能の日次の確認が送り直す
        this.logger.warn('スポンサー広告の返金の依頼を送れませんでした', {
          error,
          refundRequestId: plan.refundRequestId,
          refundKind: plan.kind,
        });
      }
    }
  }

  private async terminationFiguresOf(
    record: SponsorshipRecord,
    today: BusinessDate,
  ): Promise<TerminationFigures> {
    const unexposedDays = computeUnexposedDays({
      startsOn: record.startsOn,
      endsOn: record.endsOn,
      today,
    });
    // 強制終了日以降は未掲載日数として返金するため、表示停止日数は前日までで数え、同じ日を2回返金しない
    const stoppedDays = await this.stoppedDaysOf(
      record,
      earlierOf(addBusinessDays(today, -1), record.endsOn),
    );
    return {
      termination: {
        days: unexposedDays,
        amount: amountOf(record, unexposedDays),
      },
      displayStop: {
        days: stoppedDays,
        amount: amountOf(record, stoppedDays),
      },
    };
  }

  private async stoppedDaysOf(
    record: SponsorshipRecord,
    until: BusinessDate,
  ): Promise<number> {
    if (until < record.startsOn) {
      return 0;
    }
    const intervals = await this.displayStops.listOverlapping({
      productId: record.productId,
      userId: record.userId,
      from: startOf(record.startsOn),
      to: startOf(addBusinessDays(until, 1)),
    });
    return countStoppedDays({
      startsOn: record.startsOn,
      until,
      stops: datesOf(intervals),
    });
  }

  private planDisplayStop(
    record: SponsorshipRecord,
    figures: RefundFigures,
  ): Promise<RefundPlan> {
    if (record.productDeletedAt !== null) {
      return Promise.resolve(notNeeded('display_stop', figures));
    }
    return this.planRefund(record, 'display_stop', figures);
  }

  private async planRefund(
    record: SponsorshipRecord,
    kind: RefundKind,
    figures: RefundFigures,
  ): Promise<RefundPlan> {
    const { purchaseId } = record;
    if (figures.amount === 0 || purchaseId === null) {
      return notNeeded(kind, figures);
    }
    const reason = REASONS[kind];
    const request = (amount: number | null): Promise<PrepareResult> =>
      this.prepare({
        purchaseId,
        amount,
        reason,
        requestKey: sponsorshipRefundRequestKey(purchaseId, reason),
      });
    const first = await request(figures.amount);
    // 管理者の返金などで残りが足りなければ、残りの全額で1回だけ依頼し直す
    const result =
      first.kind === 'rejected' && first.cause === 'amount_exceeds_refundable'
        ? { ...(await request(null)), retried: true }
        : { ...first, retried: false };
    if (result.kind === 'rejected') {
      return closedPlan(record, kind, figures, result.cause);
    }
    return {
      kind,
      days: figures.days,
      amount: result.retried ? null : figures.amount,
      status: 'requested',
      refundRequestId: result.refundRequestId,
      statements: result.statements,
      incident: null,
    };
  }

  private async prepare(
    input: Parameters<PaymentRefundStatements['prepare']>[0],
  ): Promise<PrepareResult> {
    try {
      const prepared = await this.refundStatements.prepare(input);
      return prepared.kind === 'accepted'
        ? {
            kind: 'accepted',
            refundRequestId: prepared.refundRequestId,
            statements: prepared.statements,
          }
        : { kind: 'rejected', cause: prepared.code };
    } catch (error) {
      // 理由の形式違反は再処理しても直らないため、形式の誤りの拒否と同じに扱う
      if (error instanceof RangeError) {
        return { kind: 'rejected', cause: 'invalid_reason' };
      }
      throw error;
    }
  }
}
