import type { Logger } from '@logtape/logtape';
import { captureEvent } from '@sentry/cloudflare';

import { formatWeekPeriodLabel } from '../../../common-lib/tournament/week-period.ts';
import {
  TOURNAMENT_WEEK_ENTRY_REFUND_KIND,
  type WeekEntryRefundEmailInput,
} from '../../core/email/kinds/tournament-week.ts';
import type { EmailSender } from '../../core/email/ports.ts';
import type { UserContactDirectory } from '../../core/identity/ports.ts';
import { isUppercaseUlid } from '../../core/ids/uppercase-ulid.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import type { PaymentRefunds } from '../../core/payments/ports.ts';
import type {
  WeekEntryFollowUp,
  WeekEntryRecord,
  WeekTournamentStore,
} from '../../core/week-tournament/ports.ts';
import {
  refundReasonFor,
  refundRejectionOutcome,
  type WeekRefundReason,
  type WeekRefundRejectionCode,
  type WeekRefundRejectionOutcome,
  weekRefundRequestKey,
} from '../../core/week-tournament/week-entry-rules.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';

export interface WeekEntryRefundFollowUpDependencies {
  readonly appName: LoggingOptions['appName'];
  readonly store: WeekTournamentStore;
  readonly refunds: PaymentRefunds;
  readonly contacts: UserContactDirectory;
  readonly emails: EmailSender;
  readonly clientSiteOrigin: string;
  // 週ごとの1回の読み取りの件数
  readonly readLimit?: number;
}

const DEFAULT_READ_LIMIT = 50;

const PAYMENT_HISTORY_PATH = '/settings/billing';

const UNSAFE_VALUE = 'unknown';

const NOT_NEEDED_MESSAGE =
  '決済の機能が返金の依頼を不要と答えたため、返金をせずに依頼を終えました';

const PURCHASE_MISSING_MESSAGE =
  '購入の記録が無い返金待ちの参加の枠を、依頼をせずに終えました';

const ALREADY_SETTLED_MESSAGE =
  '返金できる残額が無い購入の返金の依頼を、返金済みとして終えました';

const REJECTED_MESSAGE =
  '形式の誤りで拒否された返金の依頼を、再処理の対象から外しました';

const NOTICE_INCOMPLETE_MESSAGE =
  '返金の知らせの入力を組み立てられず、送らずに省略しました';

const FAILED_MESSAGE = '返金の依頼と知らせに失敗した参加の枠があります';

// 理由の形式違反でpaymentsが投げるRangeErrorと、理由を決められない状態の枠を表す
type RefundRejectionCause = WeekRefundRejectionCode | 'invalid_reason';

const INVALID_REASON_OUTCOME: WeekRefundRejectionOutcome = Object.freeze({
  refundStatus: 'rejected',
  report: true,
});

function outcomeOf(cause: RefundRejectionCause): WeekRefundRejectionOutcome {
  return cause === 'invalid_reason'
    ? INVALID_REASON_OUTCOME
    : refundRejectionOutcome(cause);
}

function reasonOf(entry: WeekEntryRecord): WeekRefundReason | undefined {
  return entry.status === 'forfeited' || entry.status === 'excluded'
    ? refundReasonFor(entry.status)
    : undefined;
}

// タグは除去処理の対象外のため、識別子の形の値だけを送る
function safeTagOf(value: string): string {
  return isUppercaseUlid(value) ? value : UNSAFE_VALUE;
}

function failureOf(errors: readonly unknown[]): unknown {
  const [first] = errors;
  return errors.length === 1 && first instanceof Error
    ? first
    : new AggregateError(errors, FAILED_MESSAGE);
}

export class WeekEntryRefundFollowUp implements WeekEntryFollowUp {
  private readonly store: WeekTournamentStore;
  private readonly refunds: PaymentRefunds;
  private readonly contacts: UserContactDirectory;
  private readonly emails: EmailSender;
  private readonly billingUrl: string;
  private readonly readLimit: number;
  private readonly logger: Logger;

  constructor(dependencies: WeekEntryRefundFollowUpDependencies) {
    this.store = dependencies.store;
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
      'week-tournament',
      'follow-up',
    ]);
  }

  async process(entryIds: readonly string[], now: Date): Promise<void> {
    const entries: WeekEntryRecord[] = [];
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

  // 読み取りにカーソルが無く、一時的な失敗で返金待ち・知らせ待ちに残った枠は次の読み取りにも現れるため、試した枠を除いて新しい枠が無くなるまで読む
  async processTournament(tournamentId: string, now: Date): Promise<void> {
    const attempted = new Set<string>();
    const errors: unknown[] = [];
    for (;;) {
      const entries = (
        await this.store.listPendingFollowUpsOf(
          { tournamentId },
          this.readLimit,
        )
      ).filter(({ entryId }) => !attempted.has(entryId));
      if (entries.length === 0) {
        break;
      }
      for (const { entryId } of entries) {
        attempted.add(entryId);
      }
      errors.push(...(await this.handleAll(entries, now)));
    }
    if (errors.length > 0) {
      throw failureOf(errors);
    }
  }

  // 1つの枠の失敗で、更新の古い順に読む日次の再処理の残りの枠を止めないよう、全ての枠を試してから失敗を返す
  private async handleAll(
    entries: readonly WeekEntryRecord[],
    now: Date,
  ): Promise<unknown[]> {
    const weekLabels = new Map<string, string | undefined>();
    const errors: unknown[] = [];
    for (const entry of entries) {
      try {
        await this.handle(entry, weekLabels, now);
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  }

  private async handle(
    entry: WeekEntryRecord,
    weekLabels: Map<string, string | undefined>,
    now: Date,
  ): Promise<void> {
    const noticePending =
      entry.refundStatus === 'pending'
        ? await this.requestRefund(entry, now)
        : entry.refundNoticeStatus === 'pending';
    if (noticePending) {
      await this.sendNotice(entry, weekLabels, now);
    }
  }

  // 依頼を受け付けて返金の知らせを送る状態にしたらtrue
  private async requestRefund(
    entry: WeekEntryRecord,
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
    this.reportClosed(entry, purchaseId, cause, outcome);
    return false;
  }

  // 受け付けた(重複を含む)ならundefined、拒否なら拒否の原因を返す
  private async request(
    purchaseId: string,
    reason: WeekRefundReason,
  ): Promise<RefundRejectionCause | undefined> {
    try {
      const result = await this.refunds.request({
        purchaseId,
        amount: null,
        reason,
        requestKey: weekRefundRequestKey(purchaseId, reason),
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
    entry: WeekEntryRecord,
    purchaseId: string,
    code: RefundRejectionCause,
    outcome: WeekRefundRejectionOutcome,
  ): void {
    if (!outcome.report) {
      this.logger.error(NOT_NEEDED_MESSAGE, { purchaseId, code });
      return;
    }
    const alreadySettled = outcome.refundStatus === 'already_refunded';
    const message = alreadySettled ? ALREADY_SETTLED_MESSAGE : REJECTED_MESSAGE;
    const incident = alreadySettled
      ? 'refund-already-settled'
      : 'refund-rejected';
    const properties = {
      tournamentId: entry.tournamentId,
      entryId: entry.entryId,
      purchaseId,
      code,
    };
    if (alreadySettled) {
      this.logger.warn(message, properties);
    } else {
      this.logger.error(message, properties);
    }
    // captureMessageの文言だけのイベントは、直前と同じ文言と指紋なら重複として捨てられる。文言をlogentryに置くと重複の判定から外れる
    captureEvent({
      level: alreadySettled ? 'warning' : 'error',
      logentry: { message },
      fingerprint: ['tournament', incident],
      tags: {
        tournament_incident: incident,
        tournament_id: safeTagOf(entry.tournamentId),
        entry_id: safeTagOf(entry.entryId),
      },
    });
  }

  private async sendNotice(
    entry: WeekEntryRecord,
    weekLabels: Map<string, string | undefined>,
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
    const weekLabel = await this.weekLabelOf(entry.tournamentId, weekLabels);
    // 記録の欠けは送り直しても直らず、知らせ待ちに残すと日次の再処理で失敗し続けるため、省略にする
    if (reason === undefined || weekLabel === undefined) {
      this.logger.warn(NOTICE_INCOMPLETE_MESSAGE, {
        tournamentId: entry.tournamentId,
        entryId: entry.entryId,
      });
      await this.store.markNotice(entry.entryId, 'skipped', now);
      return;
    }
    const input: WeekEntryRefundEmailInput = {
      nickname: contact.nickname,
      weekLabel,
      launchDate: entry.launchDate,
      reason,
      billingUrl: this.billingUrl,
    };
    await this.emails.send({
      kind: TOURNAMENT_WEEK_ENTRY_REFUND_KIND,
      to: contact.email,
      input,
    });
    await this.store.markNotice(entry.entryId, 'sent', now);
  }

  private async weekLabelOf(
    tournamentId: string,
    weekLabels: Map<string, string | undefined>,
  ): Promise<string | undefined> {
    if (weekLabels.has(tournamentId)) {
      return weekLabels.get(tournamentId);
    }
    const tournament = await this.store.findTournament(tournamentId);
    const label =
      tournament === undefined
        ? undefined
        : formatWeekPeriodLabel(tournament.window.weekStart);
    weekLabels.set(tournamentId, label);
    return label;
  }
}
