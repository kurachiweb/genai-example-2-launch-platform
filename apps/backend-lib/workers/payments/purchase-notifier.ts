import type { Logger } from '@logtape/logtape';

import { checkoutConsentTextOf } from '../../../common-lib/payments/checkout-consent.ts';
import {
  REJECTION_REASONS,
  type RejectionReason,
} from '../../../common-lib/payments/purchase-states.ts';
import type { EmailKind } from '../../core/email/email-kind.ts';
import {
  type AutomaticRefundInput,
  PAYMENTS_AUTOMATIC_REFUND_KIND,
  PAYMENTS_PURCHASE_CONFIRMATION_KIND,
  type PurchaseConfirmationInput,
} from '../../core/email/kinds/payments.ts';
import type { EmailSender } from '../../core/email/ports.ts';
import type {
  UserContact,
  UserContactDirectory,
} from '../../core/identity/ports.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import type {
  NoticeOutcome,
  PurchaseNotifier,
  PurchaseRecord,
  PurchaseStore,
  RefundRequestRecord,
  RefundStore,
} from '../../core/payments/ports.ts';
import { isReflectionRequestKey } from '../../core/payments/refund-rules.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';

export interface EmailPurchaseNotifierDependencies {
  readonly appName: LoggingOptions['appName'];
  readonly purchases: PurchaseStore;
  readonly refunds: RefundStore;
  readonly contacts: UserContactDirectory;
  readonly emails: EmailSender;
  readonly clientSiteOrigin: string;
}

const PAYMENT_HISTORY_PATH = '/settings/billing';

type NoticeTarget =
  { readonly purchaseId: string } | { readonly refundRequestId: string };

type InputBuild<TInput> =
  | { readonly kind: 'ready'; readonly input: TInput }
  | { readonly kind: 'incomplete'; readonly reason: string };

function isRejectionReason(reason: string): reason is RejectionReason {
  return (REJECTION_REASONS as readonly string[]).includes(reason);
}

export class EmailPurchaseNotifier implements PurchaseNotifier {
  private readonly purchases: PurchaseStore;
  private readonly refunds: RefundStore;
  private readonly contacts: UserContactDirectory;
  private readonly emails: EmailSender;
  private readonly paymentHistoryUrl: string;
  private readonly logger: Logger;

  constructor(dependencies: EmailPurchaseNotifierDependencies) {
    this.purchases = dependencies.purchases;
    this.refunds = dependencies.refunds;
    this.contacts = dependencies.contacts;
    this.emails = dependencies.emails;
    this.paymentHistoryUrl = new URL(
      PAYMENT_HISTORY_PATH,
      dependencies.clientSiteOrigin,
    ).href;
    this.logger = getAppLogger([dependencies.appName, 'payments', 'notices']);
  }

  async notifyPurchase(purchaseId: string): Promise<NoticeOutcome> {
    const purchase = await this.purchases.findById(purchaseId);
    if (purchase?.confirmationEmailStatus !== 'pending') {
      return 'not_pending';
    }
    return this.request({
      target: { purchaseId },
      userId: purchase.userId,
      kind: PAYMENTS_PURCHASE_CONFIRMATION_KIND,
      build: (contact) => this.confirmationInput(purchase, contact),
      mark: (to) => this.purchases.markConfirmationEmail({ purchaseId, to }),
    });
  }

  async notifyAutomaticRefund(refundRequestId: string): Promise<NoticeOutcome> {
    const refund = await this.refunds.findById(refundRequestId);
    // 自動返金は依頼キーで見分ける。後続specの依頼は理由の値が同じでも知らせない
    if (
      refund === undefined ||
      !isReflectionRequestKey(refund.requestKey) ||
      refund.status !== 'succeeded' ||
      refund.noticeStatus !== 'pending'
    ) {
      return 'not_pending';
    }
    const purchase = await this.purchases.findById(refund.purchaseId);
    if (purchase === undefined) {
      return 'not_pending';
    }
    return this.request({
      target: { refundRequestId },
      userId: purchase.userId,
      kind: PAYMENTS_AUTOMATIC_REFUND_KIND,
      build: (contact) => this.automaticRefundInput(purchase, refund, contact),
      mark: (to) => this.refunds.markNotice({ refundRequestId, to }),
    });
  }

  private async request<TInput>(notice: {
    readonly target: NoticeTarget;
    readonly userId: string;
    readonly kind: EmailKind<string, TInput>;
    readonly build: (contact: UserContact) => InputBuild<TInput>;
    readonly mark: (to: 'requested' | 'skipped') => Promise<boolean>;
  }): Promise<NoticeOutcome> {
    const contact = await this.contacts.findContact(notice.userId);
    if (contact === undefined) {
      return (await notice.mark('skipped')) ? 'skipped' : 'not_pending';
    }
    const built = notice.build(contact);
    if (built.kind === 'incomplete') {
      this.logger.warn(
        'メールの入力を組み立てられず、依頼待ちのまま残しました',
        {
          ...notice.target,
          emailKind: notice.kind.name,
          reason: built.reason,
        },
      );
      return 'failed';
    }
    try {
      await this.emails.send({
        kind: notice.kind,
        to: contact.email,
        input: built.input,
      });
    } catch (error) {
      // 依頼待ちの行は日次の確認が依頼し直す
      this.logger.warn('メールの送信を依頼できず、依頼待ちのまま残しました', {
        ...notice.target,
        emailKind: notice.kind.name,
        error,
      });
      return 'failed';
    }
    // 依頼の後の記録の失敗では、日次の確認が同じメールをもう1通依頼し得る
    return (await notice.mark('requested')) ? 'requested' : 'not_pending';
  }

  private confirmationInput(
    purchase: PurchaseRecord,
    contact: UserContact,
  ): InputBuild<PurchaseConfirmationInput> {
    if (purchase.paidAt === null) {
      return { kind: 'incomplete', reason: 'missing_paid_at' };
    }
    if (purchase.consentedAt === null || purchase.consentVersion === null) {
      return { kind: 'incomplete', reason: 'missing_consent' };
    }
    const consentText = checkoutConsentTextOf(purchase.consentVersion);
    if (consentText === undefined) {
      return { kind: 'incomplete', reason: 'unknown_consent_version' };
    }
    return {
      kind: 'ready',
      input: {
        nickname: contact.nickname,
        itemName: purchase.summary.itemName,
        quantityLabel: purchase.summary.quantityLabel,
        amount: purchase.amountTotal,
        purchasedAt: purchase.paidAt.toISOString(),
        serviceTiming: purchase.summary.serviceTiming,
        additionalNotes: [...purchase.summary.additionalNotes],
        consentedAt: purchase.consentedAt.toISOString(),
        consentText,
        paymentHistoryUrl: this.paymentHistoryUrl,
      },
    };
  }

  private automaticRefundInput(
    purchase: PurchaseRecord,
    refund: RefundRequestRecord,
    contact: UserContact,
  ): InputBuild<AutomaticRefundInput> {
    if (purchase.paidAt === null) {
      return { kind: 'incomplete', reason: 'missing_paid_at' };
    }
    if (!isRejectionReason(refund.reason)) {
      return { kind: 'incomplete', reason: 'unknown_refund_reason' };
    }
    return {
      kind: 'ready',
      input: {
        nickname: contact.nickname,
        itemName: purchase.summary.itemName,
        quantityLabel: purchase.summary.quantityLabel,
        amount: refund.amount,
        reason: refund.reason,
        purchasedAt: purchase.paidAt.toISOString(),
        refundedAt: refund.updatedAt.toISOString(),
        paymentHistoryUrl: this.paymentHistoryUrl,
      },
    };
  }
}
