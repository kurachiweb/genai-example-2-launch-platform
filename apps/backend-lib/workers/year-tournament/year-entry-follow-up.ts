import type { Logger } from '@logtape/logtape';
import { captureEvent } from '@sentry/cloudflare';

import {
  formatWeekPeriodLabel,
  parseIsoWeek,
} from '../../../common-lib/tournament/week-period.ts';
import {
  TOURNAMENT_YEAR_ENTRY_REFUND_KIND,
  type YearEntryRefundEmailInput,
} from '../../core/email/kinds/tournament-year.ts';
import type { EmailSender } from '../../core/email/ports.ts';
import type { UserContactDirectory } from '../../core/identity/ports.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import type { PaymentRefunds } from '../../core/payments/ports.ts';
import {
  type RefundRejectionCode,
  type RefundRejectionOutcome,
  refundRejectionOutcome,
} from '../../core/tournament/refund-rejection.ts';
import type {
  YearCalendar,
  YearEntryFollowUp,
  YearEntryRecord,
  YearEntryStore,
} from '../../core/year-tournament/ports.ts';
import {
  refundReasonFor,
  type YearRefundReason,
  yearRefundRequestKey,
} from '../../core/year-tournament/year-entry-rules.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import { safeTagOf } from './incident-tags.ts';

export interface YearEntryRefundFollowUpDependencies {
  readonly appName: LoggingOptions['appName'];
  readonly store: YearEntryStore;
  readonly calendar: YearCalendar;
  readonly refunds: PaymentRefunds;
  readonly contacts: UserContactDirectory;
  readonly emails: EmailSender;
  readonly clientSiteOrigin: string;
  // 年ごとの1回の読み取りの件数
  readonly readLimit?: number;
}

const DEFAULT_READ_LIMIT = 50;

const PAYMENT_HISTORY_PATH = '/settings/billing';

const NOT_NEEDED_MESSAGE =
  '決済の機能が返金の依頼を不要と答えたため、返金をせずに依頼を終えました';

const PURCHASE_MISSING_MESSAGE =
  '購入の記録が無い返金待ちの参加の枠を、依頼をせずに終えました';

const ALREADY_REFUNDED_MESSAGE =
  '返金できる残額が無い購入の返金の依頼を、返金済みとして終えました';

const REJECTED_MESSAGE =
  '形式の誤りで拒否された返金の依頼を、再処理の対象から外しました';

const NOTICE_INCOMPLETE_MESSAGE =
  '返金の知らせの入力を組み立てられず、送らずに省略しました';

const FAILED_MESSAGE = '返金の依頼と知らせに失敗した参加の枠があります';

// 理由の形式違反でpaymentsが投げるRangeErrorと、理由を決められない状態の枠を表す
type RefundRejectionCause = RefundRejectionCode | 'invalid_reason';

const INVALID_REASON_OUTCOME: RefundRejectionOutcome = Object.freeze({
  refundStatus: 'rejected',
  report: true,
});

function outcomeOf(cause: RefundRejectionCause): RefundRejectionOutcome {
  return cause === 'invalid_reason'
    ? INVALID_REASON_OUTCOME
    : refundRejectionOutcome(cause);
}

function reasonOf(entry: YearEntryRecord): YearRefundReason | undefined {
  const { status, closeReason } = entry;
  return (status === 'forfeited' || status === 'excluded') &&
    closeReason !== null
    ? refundReasonFor(status, closeReason)
    : undefined;
}

function weekLabelOf(entry: YearEntryRecord): string | undefined {
  const week = parseIsoWeek(entry.weekPeriod);
  return week === undefined ? undefined : formatWeekPeriodLabel(week.weekStart);
}

function yearLabelOf(year: number): string {
  return `${String(year)}年`;
}

function failureOf(errors: readonly unknown[]): unknown {
  const [first] = errors;
  return errors.length === 1 && first instanceof Error
    ? first
    : new AggregateError(errors, FAILED_MESSAGE);
}

export class YearEntryRefundFollowUp implements YearEntryFollowUp {
  private readonly store: YearEntryStore;
  private readonly calendar: YearCalendar;
  private readonly refunds: PaymentRefunds;
  private readonly contacts: UserContactDirectory;
  private readonly emails: EmailSender;
  private readonly billingUrl: string;
  private readonly readLimit: number;
  private readonly logger: Logger;

  constructor(dependencies: YearEntryRefundFollowUpDependencies) {
    this.store = dependencies.store;
    this.calendar = dependencies.calendar;
    this.refunds = dependencies.refunds;
    this.contacts = dependencies.contacts;
    this.emails = dependencies.emails;
    this.billingUrl = new URL(
      PAYMENT_HISTORY_PATH,
      dependencies.clientSiteOrigin,
    ).href;
    this.readLimit = dependencies.readLimit ?? DEFAULT_READ_LIMIT;
    this.logger = getAppLogger([
      dependencies.appName,
      'year-tournament',
      'follow-up',
    ]);
  }

  async process(entryIds: readonly string[], now: Date): Promise<void> {
    const entries: YearEntryRecord[] = [];
    for (const entryId of new Set(entryIds)) {
      const entry = await this.store.findEntry(entryId);
      if (entry !== undefined) {
        entries.push(entry);
      }
    }
    const errors = await this.handleAll(entries, now);
    if (errors.length > 0) {
      throw failureOf(errors);
    }
  }

  // 枠のストアに年で絞る読み取りが無いため、nowまでに更新した返金待ち・知らせ待ちの枠を更新の古い順に読み、その年の組み合わせ決定で終えた枠だけを処理する。
  // 読み取りにカーソルが無く、一時的な失敗の枠と他の年の枠は次の読み取りにも現れるため、読んだ枠を除いて新しい枠が無くなるまで読む
  async processYear(year: number, now: Date): Promise<void> {
    const updatedUntil = new Date(now.getTime() + 1);
    const seen = new Set<string>();
    const errors: unknown[] = [];
    for (;;) {
      const entries = (
        await this.store.listPendingFollowUps(updatedUntil, this.readLimit)
      ).filter(({ entryId }) => !seen.has(entryId));
      if (entries.length === 0) {
        break;
      }
      for (const { entryId } of entries) {
        seen.add(entryId);
      }
      errors.push(
        ...(await this.handleAll(
          entries.filter(({ classifiedYear }) => classifiedYear === year),
          now,
        )),
      );
    }
    if (errors.length > 0) {
      throw failureOf(errors);
    }
  }

  // 1つの枠の失敗で、更新の古い順に読む日次の再処理の残りの枠を止めないよう、全ての枠を試してから失敗を返す
  private async handleAll(
    entries: readonly YearEntryRecord[],
    now: Date,
  ): Promise<unknown[]> {
    const yearLabels = new Map<string, string | undefined>();
    const errors: unknown[] = [];
    for (const entry of entries) {
      try {
        await this.handle(entry, yearLabels, now);
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  }

  private async handle(
    entry: YearEntryRecord,
    yearLabels: Map<string, string | undefined>,
    now: Date,
  ): Promise<void> {
    const noticePending =
      entry.refundStatus === 'pending'
        ? await this.requestRefund(entry, now)
        : entry.refundNoticeStatus === 'pending';
    if (noticePending) {
      await this.sendNotice(entry, yearLabels, now);
    }
  }

  // 依頼を受け付けて返金の知らせを送る状態にしたらtrue
  private async requestRefund(
    entry: YearEntryRecord,
    now: Date,
  ): Promise<boolean> {
    const { purchaseId } = entry;
    if (purchaseId === null) {
      this.logger.error(PURCHASE_MISSING_MESSAGE, { entryId: entry.entryId });
      await this.store.markRefundClosed(entry.entryId, 'not_needed', now);
      return false;
    }
    const reason = reasonOf(entry);
    const cause =
      reason === undefined
        ? 'invalid_reason'
        : await this.request(purchaseId, reason);
    if (cause === undefined) {
      await this.store.markRefundRequested(entry.entryId, now);
      return true;
    }
    const outcome = outcomeOf(cause);
    await this.store.markRefundClosed(entry.entryId, outcome.refundStatus, now);
    this.reportClosed(entry.entryId, purchaseId, cause, outcome);
    return false;
  }

  // 受け付けた(重複を含む)ならundefined、拒否なら拒否の原因を返す
  private async request(
    purchaseId: string,
    reason: YearRefundReason,
  ): Promise<RefundRejectionCause | undefined> {
    try {
      const result = await this.refunds.request({
        purchaseId,
        amount: null,
        reason,
        requestKey: yearRefundRequestKey(purchaseId, reason),
      });
      return result.kind === 'accepted' ? undefined : result.code;
    } catch (error) {
      // 理由の形式違反は再処理しても直らないため、形式の誤りの拒否と同じに扱う
      if (error instanceof RangeError) {
        return 'invalid_reason';
      }
      throw error;
    }
  }

  private reportClosed(
    entryId: string,
    purchaseId: string,
    code: RefundRejectionCause,
    outcome: RefundRejectionOutcome,
  ): void {
    const properties = { entryId, purchaseId, code };
    if (!outcome.report) {
      this.logger.info(NOT_NEEDED_MESSAGE, properties);
      return;
    }
    const alreadyRefunded = outcome.refundStatus === 'already_refunded';
    const message = alreadyRefunded
      ? ALREADY_REFUNDED_MESSAGE
      : REJECTED_MESSAGE;
    const incident = alreadyRefunded
      ? 'refund-already-refunded'
      : 'refund-rejected';
    if (alreadyRefunded) {
      this.logger.warn(message, properties);
    } else {
      this.logger.error(message, properties);
    }
    // captureMessageの文言だけのイベントは、直前と同じ文言と指紋なら重複として捨てられる。文言をlogentryに置くと重複の判定から外れる
    captureEvent({
      level: alreadyRefunded ? 'warning' : 'error',
      logentry: { message },
      fingerprint: ['tournament-year', incident],
      tags: {
        tournament_year_incident: incident,
        entry_id: safeTagOf(entryId),
        purchase_id: safeTagOf(purchaseId),
      },
    });
  }

  private async sendNotice(
    entry: YearEntryRecord,
    yearLabels: Map<string, string | undefined>,
    now: Date,
  ): Promise<void> {
    if (entry.ownerUserId === null) {
      await this.store.markNotice(entry.entryId, 'skipped', now);
      return;
    }
    const contact = await this.contacts.findContact(entry.ownerUserId);
    if (contact === undefined) {
      await this.store.markNotice(entry.entryId, 'skipped', now);
      return;
    }
    const reason = reasonOf(entry);
    const weekLabel = weekLabelOf(entry);
    const yearLabel = await this.yearLabelOf(entry, yearLabels, now);
    // 記録の欠けは送り直しても直らず、知らせ待ちに残すと日次の再処理で失敗し続けるため、省略にする
    if (
      reason === undefined ||
      weekLabel === undefined ||
      yearLabel === undefined
    ) {
      this.logger.warn(NOTICE_INCOMPLETE_MESSAGE, { entryId: entry.entryId });
      await this.store.markNotice(entry.entryId, 'skipped', now);
      return;
    }
    const input: YearEntryRefundEmailInput = {
      nickname: contact.nickname,
      yearLabel,
      weekLabel,
      reason,
      billingUrl: this.billingUrl,
    };
    await this.emails.send({
      kind: TOURNAMENT_YEAR_ENTRY_REFUND_KIND,
      to: contact.email,
      input,
    });
    await this.store.markNotice(entry.entryId, 'sent', now);
  }

  // 組み合わせ決定で終えた枠は終えた年、凍結の前に喪失した枠はWeek優勝の日の対象年(凍結の後は遅れとして同じ年)を示す
  private async yearLabelOf(
    entry: YearEntryRecord,
    yearLabels: Map<string, string | undefined>,
    now: Date,
  ): Promise<string | undefined> {
    if (entry.classifiedYear !== null) {
      return yearLabelOf(entry.classifiedYear);
    }
    const { awardedDate } = entry;
    if (yearLabels.has(awardedDate)) {
      return yearLabels.get(awardedDate);
    }
    let label: string | undefined;
    try {
      const target = await this.calendar.resolveAward(awardedDate, now);
      label = yearLabelOf(
        target.kind === 'open' ? target.year.year : target.year,
      );
    } catch (error) {
      // 対象年の無いWeek優勝の日は記録の欠けと同じく直らないため省略にし、それ以外の失敗は呼び出し元の再試行に任せる
      if (!(error instanceof RangeError)) {
        throw error;
      }
      label = undefined;
    }
    yearLabels.set(awardedDate, label);
    return label;
  }
}
