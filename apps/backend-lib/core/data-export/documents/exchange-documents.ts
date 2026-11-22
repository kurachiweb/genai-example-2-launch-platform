import type {
  ExportInquiry,
  ExportPayment,
  ExportProductRef,
  ExportSponsorship,
} from '../export-snapshot.ts';
import { toIsoUtc } from './export-formats.ts';
import { storedPathOf } from './file-reference.ts';
import type { DocumentInput } from './file-reference.ts';

export interface InquiryAttachmentDocument {
  readonly path: string | null;
  readonly contentType: string;
  readonly size: number;
}

export interface InquiryMessageDocument {
  readonly id: string;
  readonly sender: 'user' | 'admin';
  readonly adminNickname: string | null;
  readonly body: string;
  readonly attachments: readonly InquiryAttachmentDocument[];
  readonly createdAt: string;
}

export interface InquiryDocument {
  readonly id: string;
  readonly category: string;
  readonly status: ExportInquiry['status'];
  readonly createdAt: string;
  readonly messages: readonly InquiryMessageDocument[];
}

export interface SponsorshipDocument {
  readonly id: string;
  readonly product: ExportProductRef;
  readonly tier: ExportSponsorship['tier'];
  readonly startsOn: string;
  readonly endsOn: string;
  readonly days: number;
  readonly status: ExportSponsorship['status'];
  readonly paymentId: string | null;
  readonly createdAt: string;
}

export interface PaymentDocument {
  readonly id: string;
  readonly kind: ExportPayment['kind'];
  readonly purpose: ExportPayment['purpose'];
  readonly amount: number;
  readonly currency: 'usd';
  readonly quantity: number | null;
  readonly status: ExportPayment['status'];
  readonly stripeReference: string;
  readonly relatedId: string | null;
  readonly occurredAt: string;
}

// 項目を明示して写す。上流の取得結果に余分な項目が混ざっても出力へ出さないため
export function buildInquiriesDocument(
  input: DocumentInput,
): readonly InquiryDocument[] {
  return input.snapshot.inquiries.map((inquiry) => ({
    id: inquiry.id,
    category: inquiry.category,
    status: inquiry.status,
    createdAt: toIsoUtc(inquiry.createdAt),
    messages: inquiry.messages.map((message) => ({
      id: message.id,
      sender: message.sender,
      adminNickname: message.adminNickname,
      body: message.body,
      attachments: message.attachments.map((attachment) => ({
        path: storedPathOf(input, attachment.fileId),
        contentType: attachment.contentType,
        size: attachment.size,
      })),
      createdAt: toIsoUtc(message.createdAt),
    })),
  }));
}

export function buildSponsorshipsDocument(
  sponsorships: readonly ExportSponsorship[],
): readonly SponsorshipDocument[] {
  return sponsorships.map((sponsorship) => ({
    id: sponsorship.id,
    product: {
      name: sponsorship.product.name,
      handle: sponsorship.product.handle,
    },
    tier: sponsorship.tier,
    startsOn: sponsorship.startsOn,
    endsOn: sponsorship.endsOn,
    days: sponsorship.days,
    status: sponsorship.status,
    paymentId: sponsorship.paymentId,
    createdAt: toIsoUtc(sponsorship.createdAt),
  }));
}

export function buildPaymentsDocument(
  payments: readonly ExportPayment[],
): readonly PaymentDocument[] {
  return payments.map((payment) => ({
    id: payment.id,
    kind: payment.kind,
    purpose: payment.purpose,
    amount: payment.amount,
    currency: payment.currency,
    quantity: payment.quantity,
    status: payment.status,
    stripeReference: payment.stripeReference,
    relatedId: payment.relatedId,
    occurredAt: toIsoUtc(payment.occurredAt),
  }));
}
