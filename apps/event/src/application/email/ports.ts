import type { ExtraHeaders } from '../../../lib/core/email/email-headers.ts';
import type {
  AnyEmailKind,
  EmailCategory,
} from '../../../lib/core/email/email-kind.ts';
import type { SenderInfo } from '../../../lib/core/email/ports.ts';
import type { EmailProviderOutcome } from '../../../lib/core/email/provider-outcome.ts';
import type { SuppressionEffect } from '../../../lib/core/email/suppression-policy.ts';

export interface EmailRuntimeConfig {
  readonly fromAddress: string;
  readonly fromName: 'Launch Stadium';
}

export interface OutgoingEmail {
  readonly from: { readonly address: string; readonly name: string };
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly headers: ExtraHeaders;
}

export interface EmailProvider {
  // 失敗も結果として返し、例外を投げない
  send(email: OutgoingEmail): Promise<EmailProviderOutcome>;
}

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export class EmailRenderError extends Error {
  override readonly name = 'EmailRenderError';
}

export interface EmailRenderer {
  // 失敗はEmailRenderErrorで投げる
  render(
    kind: AnyEmailKind,
    input: unknown,
    senderInfo: SenderInfo | undefined,
  ): Promise<RenderedEmail>;
}

type DeliveryReportCategory = Extract<
  SuppressionEffect,
  { kind: 'report' }
>['category'];

// 宛先・件名・本文・入力・URLはエラートラッキングへ送らないため、通知の型に持たせない
export type EmailIncident =
  | {
      readonly kind: 'undeliverable';
      readonly emailKind: string;
      // 未登録の種別では分類が決まらない
      readonly category: EmailCategory | undefined;
      readonly requestId: string;
      readonly code: string;
    }
  | { readonly kind: 'daily-limit' }
  | {
      readonly kind: DeliveryReportCategory;
      readonly reason: string;
    }
  | {
      readonly kind: 'invalid-delivery-event';
      readonly type: string | undefined;
    };

export interface EmailIncidentReporter {
  report(incident: EmailIncident): void;
}
