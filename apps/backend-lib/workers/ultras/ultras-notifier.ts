import type { Logger } from '@logtape/logtape';
import { z } from 'zod';

import type { EmailKind } from '../../core/email/email-kind.ts';
import {
  type CancellationAcceptedInput,
  type PaymentFailedInput,
  ULTRAS_CANCELLATION_ACCEPTED_KIND,
  ULTRAS_PAYMENT_FAILED_KIND,
} from '../../core/email/kinds/ultras.ts';
import type { EmailSender } from '../../core/email/ports.ts';
import type {
  UserContact,
  UserContactDirectory,
} from '../../core/identity/ports.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import type { Clock } from '../../core/time/clock.ts';
import type {
  NoticeStore,
  UltrasNoticeRow,
  UltrasNotifier,
} from '../../core/ultras/ports.ts';
import type { SubscriptionTransitionNotice } from '../../core/ultras/subscription-transition.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';

export interface EmailUltrasNotifierDependencies {
  readonly appName: LoggingOptions['appName'];
  readonly notices: NoticeStore;
  readonly contacts: UserContactDirectory;
  readonly emails: EmailSender;
  readonly clock: Clock;
  readonly clientSiteOrigin: string;
}

export type NoticePayloadSource = Pick<
  SubscriptionTransitionNotice,
  'acceptedAt' | 'benefitEndsAt'
>;

const PLAN_PATH = '/settings/plan';

const PAYLOAD_KEYS = Object.freeze({
  acceptedAt: 'acceptedAt',
  benefitEndsAt: 'benefitEndsAt',
});

type SendOutcome = Awaited<ReturnType<UltrasNotifier['send']>>;

type InputBuild<TInput> =
  | { readonly kind: 'ready'; readonly input: TInput }
  | { readonly kind: 'incomplete'; readonly reason: string };

// 依頼の内容は文字列の辞書で保存するため、日時はISO 8601の瞬時で書き、開いている特典の終了日時は省く
export function noticePayloadOf(
  notice: NoticePayloadSource,
): Readonly<Record<string, string>> {
  return {
    [PAYLOAD_KEYS.acceptedAt]: notice.acceptedAt.toISOString(),
    ...(notice.benefitEndsAt === null
      ? {}
      : { [PAYLOAD_KEYS.benefitEndsAt]: notice.benefitEndsAt.toISOString() }),
  };
}

const instantSchema = z.iso.datetime();

type PayloadInstant =
  | { readonly kind: 'present'; readonly value: string }
  | { readonly kind: 'missing' | 'invalid' };

// 送信側の入力の検証で毎日失敗し続ける依頼を残さないため、ISO 8601の瞬時でない値も欠けと同じに対象外へ回す
function payloadInstant(
  payload: UltrasNoticeRow['payload'],
  key: string,
): PayloadInstant {
  const value = payload[key];
  if (value === undefined || value === '') {
    return { kind: 'missing' };
  }
  return instantSchema.safeParse(value).success
    ? { kind: 'present', value }
    : { kind: 'invalid' };
}

export class EmailUltrasNotifier implements UltrasNotifier {
  private readonly notices: NoticeStore;
  private readonly contacts: UserContactDirectory;
  private readonly emails: EmailSender;
  private readonly clock: Clock;
  private readonly planUrl: string;
  private readonly logger: Logger;

  constructor(dependencies: EmailUltrasNotifierDependencies) {
    this.notices = dependencies.notices;
    this.contacts = dependencies.contacts;
    this.emails = dependencies.emails;
    this.clock = dependencies.clock;
    this.planUrl = new URL(PLAN_PATH, dependencies.clientSiteOrigin).href;
    this.logger = getAppLogger([dependencies.appName, 'application', 'ultras']);
  }

  async sendPendingFor(stripeSubscriptionId: string): Promise<void> {
    const pending =
      await this.notices.findPendingBySubscription(stripeSubscriptionId);
    for (const notice of pending) {
      try {
        await this.send(notice);
      } catch (error) {
        // 依頼待ちの行は日次の確認が依頼し直すため、1件の失敗で残りの依頼を止めない
        this.logger.warn('メールの送信を依頼できず、依頼待ちのまま残しました', {
          noticeId: notice.id,
          kind: notice.kind,
          stripeSubscriptionId,
          error,
        });
      }
    }
  }

  async send(notice: UltrasNoticeRow): Promise<SendOutcome> {
    if (notice.status !== 'pending') {
      return 'not_pending';
    }
    const contact = await this.contacts.findContact(notice.userId);
    if (contact === undefined) {
      await this.notices.markSkipped(notice.id, this.clock.now());
      return 'skipped';
    }
    switch (notice.kind) {
      case 'payment_failed':
        return this.request(
          notice,
          ULTRAS_PAYMENT_FAILED_KIND,
          contact.email,
          this.paymentFailedInput(contact),
        );
      case 'cancellation_accepted':
        return this.request(
          notice,
          ULTRAS_CANCELLATION_ACCEPTED_KIND,
          contact.email,
          this.cancellationAcceptedInput(notice, contact),
        );
    }
  }

  private async request<TInput>(
    notice: UltrasNoticeRow,
    kind: EmailKind<string, TInput>,
    to: string,
    built: InputBuild<TInput>,
  ): Promise<SendOutcome> {
    // 記録の欠けは依頼し直しても直らず、依頼待ちに残すと日次の確認の枠を塞ぎ続けるため、対象外にする
    if (built.kind === 'incomplete') {
      this.logger.warn('メールの入力を組み立てられず、対象外にしました', {
        noticeId: notice.id,
        kind: notice.kind,
        reason: built.reason,
      });
      await this.notices.markSkipped(notice.id, this.clock.now());
      return 'skipped';
    }
    await this.emails.send({ kind, to, input: built.input });
    // 依頼の後の記録の失敗では、日次の確認が同じメールをもう1通依頼し得る
    const marked = await this.notices.markRequested(
      notice.id,
      this.clock.now(),
    );
    return marked === 'updated' ? 'requested' : 'not_pending';
  }

  private paymentFailedInput(
    contact: UserContact,
  ): InputBuild<PaymentFailedInput> {
    return {
      kind: 'ready',
      input: { nickname: contact.nickname, planUrl: this.planUrl },
    };
  }

  private cancellationAcceptedInput(
    notice: UltrasNoticeRow,
    contact: UserContact,
  ): InputBuild<CancellationAcceptedInput> {
    const acceptedAt = payloadInstant(notice.payload, PAYLOAD_KEYS.acceptedAt);
    if (acceptedAt.kind !== 'present') {
      return { kind: 'incomplete', reason: `${acceptedAt.kind}_accepted_at` };
    }
    const benefitEndsAt = payloadInstant(
      notice.payload,
      PAYLOAD_KEYS.benefitEndsAt,
    );
    if (benefitEndsAt.kind !== 'present') {
      return {
        kind: 'incomplete',
        reason: `${benefitEndsAt.kind}_benefit_ends_at`,
      };
    }
    return {
      kind: 'ready',
      input: {
        nickname: contact.nickname,
        acceptedAt: acceptedAt.value,
        benefitEndsAt: benefitEndsAt.value,
        planUrl: this.planUrl,
      },
    };
  }
}
