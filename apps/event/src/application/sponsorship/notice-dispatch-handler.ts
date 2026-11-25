import {
  MINOR_UNITS_PER_DOLLAR,
  PAYMENT_DISPLAY_CURRENCY,
} from '../../../common-lib/payments/money.ts';
import { SPONSORSHIP_TIER_LABELS } from '../../../common-lib/sponsorship/sponsorship-tiers.ts';
import {
  SPONSORSHIP_END_NOTICE_EMAIL,
  SPONSORSHIP_START_NOTICE_EMAIL,
  SPONSORSHIP_TERMINATION_NOTICE_EMAIL,
  type SponsorshipRefundNotice,
  type SponsorshipStartNoticeInput,
} from '../../../lib/core/email/kinds/sponsorship.ts';
import {
  type EmailSender,
  EmailSendError,
} from '../../../lib/core/email/ports.ts';
import type {
  UserContact,
  UserContactDirectory,
} from '../../../lib/core/identity/ports.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { SponsorshipRequestBody } from '../../../lib/core/messaging/contracts/sponsorship.ts';
import type {
  MessageHandler,
  MessageHandlingResult,
} from '../../../lib/core/messaging/message-contract.ts';
import type {
  ProductDirectory,
  ProductLookupScope,
} from '../../../lib/core/product/ports.ts';
import type {
  SponsorshipRecord,
  SponsorshipRefundRecord,
} from '../../../lib/core/sponsorship/ports.ts';
import {
  type BusinessDate,
  toBusinessDateTime,
} from '../../../lib/core/time/business-time.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type {
  NoticeClaimStore,
  PendingSponsorshipNotice,
  SponsorshipNoticeKind,
} from './ports.ts';

export const NOTICE_DISPATCH_LIMIT = 20;

export const NOTICE_CONTINUE_DELAY_SECONDS = 5;

const LIST_PATH = '/settings/sponsorships';

const LEGAL_PATH = '/legal';

const FULL_REMAINING_AMOUNT = '残りの全額';

// メールは受信者のロケールを知り得ないため、ロケールを固定する
const USD_FORMAT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: PAYMENT_DISPLAY_CURRENCY,
});

const DONE: MessageHandlingResult = Object.freeze({ kind: 'done' });

const CONTINUE: MessageHandlingResult = Object.freeze({
  kind: 'defer',
  delaySeconds: NOTICE_CONTINUE_DELAY_SECONDS,
});

const logger = getAppLogger(['event', 'sponsorship']);

type SkipReason =
  | 'sponsorship_deleted'
  | 'state_changed'
  | 'period_ended'
  | 'product_unavailable'
  | 'recipient_unavailable';

type NoticeResult = 'sent' | 'skipped' | 'taken';

type Delivery =
  | { readonly kind: 'sent' }
  | { readonly kind: 'skipped'; readonly reason: SkipReason };

// 開始は表示されている広告にだけ送るため可視のプロダクトに限り、終了と強制終了は非公開化・停止中でも名称を示せるよう論理削除だけを除く
const PRODUCT_SCOPES: Readonly<
  Record<SponsorshipNoticeKind, ProductLookupScope>
> = Object.freeze({
  start: 'visible',
  end: 'not-deleted',
  termination: 'not-deleted',
});

export interface NoticeDispatchHandlerDependencies {
  readonly claims: NoticeClaimStore;
  readonly contacts: UserContactDirectory;
  readonly products: ProductDirectory;
  readonly emails: EmailSender;
  readonly clock: Clock;
  readonly clientSiteOrigin: string;
}

function skipped(reason: SkipReason): Delivery {
  return { kind: 'skipped', reason };
}

function businessDateOf(instant: Date): BusinessDate {
  return toBusinessDateTime(instant).date;
}

function formatUsd(amount: number): string {
  return USD_FORMAT.format(amount / MINOR_UNITS_PER_DOLLAR);
}

// 依頼した返金だけを本文に載せ、返金不要・返金済み・拒否・未精算は載せない
function refundNoticeOf(
  refund: SponsorshipRefundRecord,
): SponsorshipRefundNotice | null {
  if (refund.status !== 'requested' || refund.days === null) {
    return null;
  }
  return {
    days: refund.days,
    amount:
      refund.amount === null ? FULL_REMAINING_AMOUNT : formatUsd(refund.amount),
  };
}

// 申込の記録だけで決まる送信の時点の条件(8.6・8.7・10.5)
function recordSkipReason(
  kind: SponsorshipNoticeKind,
  record: SponsorshipRecord,
  today: BusinessDate,
): SkipReason | undefined {
  switch (kind) {
    case 'start':
      if (record.state !== 'paid') {
        return 'state_changed';
      }
      return today > record.endsOn ? 'period_ended' : undefined;
    case 'end':
      if (record.state !== 'paid') {
        return 'state_changed';
      }
      return record.productDeletedAt === null
        ? undefined
        : 'product_unavailable';
    case 'termination':
      return record.state === 'terminated' ? undefined : 'state_changed';
  }
}

// プロダクトの名称・利用者のメールアドレス・強制終了の理由をログとエラートラッキングへ出さないため、ログの属性は申込のIDと通知の種類と結果だけにする
export class NoticeDispatchHandler implements MessageHandler<SponsorshipRequestBody> {
  private readonly claims: NoticeClaimStore;
  private readonly contacts: UserContactDirectory;
  private readonly products: ProductDirectory;
  private readonly emails: EmailSender;
  private readonly clock: Clock;
  private readonly clientSiteOrigin: string;

  constructor(dependencies: NoticeDispatchHandlerDependencies) {
    this.claims = dependencies.claims;
    this.contacts = dependencies.contacts;
    this.products = dependencies.products;
    this.emails = dependencies.emails;
    this.clock = dependencies.clock;
    this.clientSiteOrigin = dependencies.clientSiteOrigin;
  }

  async handle(): Promise<MessageHandlingResult> {
    const now = this.clock.now();
    const today = businessDateOf(now);
    const pending = await this.claims.listPending(NOTICE_DISPATCH_LIMIT + 1);
    const counts: Record<NoticeResult, number> = {
      sent: 0,
      skipped: 0,
      taken: 0,
    };
    for (const notice of pending.slice(0, NOTICE_DISPATCH_LIMIT)) {
      counts[await this.dispatch(notice, now, today)] += 1;
    }
    const more = pending.length > NOTICE_DISPATCH_LIMIT;
    logger.info('スポンサー広告の通知を処理しました', { ...counts, more });
    return more ? CONTINUE : DONE;
  }

  // 同時の処理で重ねて送らないよう、送る前に依頼済みへ取る。取った後の一時的な失敗は依頼待ちに戻してメッセージの再試行に任せる
  private async dispatch(
    notice: PendingSponsorshipNotice,
    now: Date,
    today: BusinessDate,
  ): Promise<NoticeResult> {
    const claim = await this.claims.claim(notice, now);
    if (claim === undefined) {
      return 'taken';
    }
    try {
      const delivery =
        claim.kind === 'deleted'
          ? skipped('sponsorship_deleted')
          : await this.deliver(notice.kind, claim.record, today);
      if (delivery.kind === 'sent') {
        return 'sent';
      }
      await this.claims.markSkipped(notice, now);
      logger.info('スポンサー広告の通知を送らないと記録しました', {
        sponsorshipId: notice.sponsorshipId,
        notice: notice.kind,
        reason: delivery.reason,
      });
      return 'skipped';
    } catch (error) {
      if (error instanceof EmailSendError) {
        await this.claims.markSkipped(notice, now);
        logger.warn(
          '送信を受け付けられなかったスポンサー広告の通知を、送らないと記録しました',
          {
            sponsorshipId: notice.sponsorshipId,
            notice: notice.kind,
            reason: error.reason,
          },
        );
        return 'skipped';
      }
      await this.claims.release(notice, now);
      throw error;
    }
  }

  private async deliver(
    kind: SponsorshipNoticeKind,
    record: SponsorshipRecord,
    today: BusinessDate,
  ): Promise<Delivery> {
    const reason = recordSkipReason(kind, record, today);
    if (reason !== undefined) {
      return skipped(reason);
    }
    const summaries = await this.products.findSummaries(
      [record.productId],
      PRODUCT_SCOPES[kind],
    );
    const product = summaries.get(record.productId);
    if (product === undefined) {
      return skipped('product_unavailable');
    }
    const contact = await this.contacts.findContact(record.userId);
    if (contact === undefined) {
      return skipped('recipient_unavailable');
    }
    const sent = await this.send(
      kind,
      record,
      this.baseInputOf(record, product.name, contact),
      contact.email,
    );
    return sent ? { kind: 'sent' } : skipped('state_changed');
  }

  private baseInputOf(
    record: SponsorshipRecord,
    productName: string,
    contact: UserContact,
  ): SponsorshipStartNoticeInput {
    return {
      nickname: contact.nickname,
      productName,
      tierLabel: SPONSORSHIP_TIER_LABELS[record.tier],
      startsOn: record.startsOn,
      endsOn: record.endsOn,
      days: record.days,
      listUrl: `${this.clientSiteOrigin}${LIST_PATH}`,
    };
  }

  private async send(
    kind: SponsorshipNoticeKind,
    record: SponsorshipRecord,
    base: SponsorshipStartNoticeInput,
    to: string,
  ): Promise<boolean> {
    switch (kind) {
      case 'start':
        await this.emails.send({
          kind: SPONSORSHIP_START_NOTICE_EMAIL,
          to,
          input: base,
        });
        return true;
      case 'end':
        await this.emails.send({
          kind: SPONSORSHIP_END_NOTICE_EMAIL,
          to,
          input: { ...base, stopRefund: refundNoticeOf(record.stopRefund) },
        });
        return true;
      case 'termination':
        return this.sendTermination(record, base, to);
    }
  }

  // 強制終了の日時と理由はCHECK制約で強制終了の申込に必ずあるが、型の上で欠けた記録は状態の食い違いとして送らない
  private async sendTermination(
    record: SponsorshipRecord,
    base: SponsorshipStartNoticeInput,
    to: string,
  ): Promise<boolean> {
    const { terminatedAt, terminationReason } = record;
    if (terminatedAt === null || terminationReason === null) {
      return false;
    }
    await this.emails.send({
      kind: SPONSORSHIP_TERMINATION_NOTICE_EMAIL,
      to,
      input: {
        ...base,
        terminatedOn: businessDateOf(terminatedAt),
        reason: terminationReason,
        legalUrl: `${this.clientSiteOrigin}${LEGAL_PATH}`,
        terminationRefund: refundNoticeOf(record.terminationRefund),
        stopRefund: refundNoticeOf(record.stopRefund),
      },
    });
    return true;
  }
}
