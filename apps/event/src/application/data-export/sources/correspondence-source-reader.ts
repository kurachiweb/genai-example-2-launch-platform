import { inject, injectable } from 'inversify';

import type {
  ExportInquiry,
  ExportPayment,
  ExportReport,
  ExportSponsorship,
} from '../../../../lib/core/data-export/export-snapshot.ts';
import { INQUIRY_EXPORT_TYPES } from '../../../../lib/core/inquiry/identifiers.ts';
import type {
  InquiryExport,
  InquiryExportItem,
} from '../../../../lib/core/inquiry/ports.ts';
import { PAYMENTS_TYPES } from '../../../../lib/core/payments/identifiers.ts';
import type {
  PaymentHistoryExport,
  PaymentHistoryExportItem,
} from '../../../../lib/core/payments/ports.ts';
import { REPORTING_PLATFORM_TYPES } from '../../../../lib/core/reporting/identifiers.ts';
import type {
  ReportExport,
  ReportExportRecord,
} from '../../../../lib/core/reporting/ports.ts';
import { SPONSORSHIP_PLATFORM_TYPES } from '../../../../lib/core/sponsorship/identifiers.ts';
import type { SponsorshipExport } from '../../../../lib/core/sponsorship/ports.ts';

const REPORT_PAGE_SIZE = 20;

export interface CorrespondenceSource {
  readonly reports: readonly ExportReport[];
  readonly inquiries: readonly ExportInquiry[];
  readonly sponsorships: readonly ExportSponsorship[];
  readonly payments: readonly ExportPayment[];
}

function toExportReport(record: ReportExportRecord): ExportReport {
  return {
    id: record.id,
    targetType: record.targetType,
    targetRef: record.targetRef,
    category: record.category,
    reason: record.reason,
    createdAt: record.createdAt,
  };
}

function toExportInquiry(item: InquiryExportItem): ExportInquiry {
  return {
    id: item.id,
    category: item.category,
    status: item.status,
    createdAt: new Date(item.createdAt),
    messages: item.messages.map((message) => ({
      id: message.id,
      sender: message.sender,
      adminNickname: message.adminNickname,
      body: message.body,
      attachments: message.attachments.map((attachment) => ({
        fileId: attachment.fileId,
        originalFileName: attachment.originalFileName,
        contentType: attachment.contentType,
        size: attachment.size,
      })),
      createdAt: new Date(message.createdAt),
    })),
  };
}

type ExportablePaymentItem = PaymentHistoryExportItem & {
  readonly purpose: ExportPayment['purpose'];
};

// payments_smokeは決済の疎通確認だけに使う購入の種別で、利用者の取引ではないためデータエクスポートの対象にしない
function isExportablePayment(
  item: PaymentHistoryExportItem,
): item is ExportablePaymentItem {
  return item.purpose !== 'payments_smoke';
}

function toExportPayment(item: ExportablePaymentItem): ExportPayment {
  return {
    id: item.id,
    kind: item.kind,
    purpose: item.purpose,
    amount: item.amount,
    currency: item.currency,
    quantity: item.quantity,
    status: item.status,
    stripeReference: item.stripeReference,
    relatedId: item.relatedId,
    occurredAt: new Date(item.occurredAt),
  };
}

// 他のspecの出力用の部品を呼んで、利用者の通報・問い合わせ・スポンサー広告・決済履歴をスナップショットの形へ写す
@injectable()
export class CorrespondenceSourceReader {
  constructor(
    @inject(REPORTING_PLATFORM_TYPES.ReportExport)
    private readonly reportExport: ReportExport,
    @inject(INQUIRY_EXPORT_TYPES.InquiryExport)
    private readonly inquiryExport: InquiryExport,
    @inject(SPONSORSHIP_PLATFORM_TYPES.SponsorshipExport)
    private readonly sponsorshipExport: SponsorshipExport,
    @inject(PAYMENTS_TYPES.PaymentHistoryExport)
    private readonly paymentHistoryExport: PaymentHistoryExport,
  ) {}

  // pseudonymousIdはアカウントの部品が返す値で、決済履歴の照会だけに使い結果へ含めない
  async read(
    userId: string,
    pseudonymousId: string,
    now: Date,
  ): Promise<CorrespondenceSource> {
    const reports = await this.readAllReports(userId);
    const inquiries = await this.readAllInquiries(userId);
    const sponsorships = await this.sponsorshipExport.listByUser(userId, now);
    const payments = await this.paymentHistoryExport.listAll(pseudonymousId);

    return {
      reports,
      inquiries,
      sponsorships: sponsorships.map((sponsorship) => ({
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
        createdAt: sponsorship.createdAt,
      })),
      payments: payments.filter(isExportablePayment).map(toExportPayment),
    };
  }

  private async readAllReports(userId: string): Promise<ExportReport[]> {
    const reports: ExportReport[] = [];
    let after: string | undefined;
    do {
      const page = await this.reportExport.listPage({
        userId,
        after,
        limit: REPORT_PAGE_SIZE,
      });
      reports.push(...page.records.map(toExportReport));
      after = page.nextAfter ?? undefined;
    } while (after !== undefined);
    return reports;
  }

  private async readAllInquiries(userId: string): Promise<ExportInquiry[]> {
    const inquiries: ExportInquiry[] = [];
    let after: string | undefined;
    do {
      const page = await this.inquiryExport.listPage(userId, after);
      inquiries.push(...page.items.map(toExportInquiry));
      after = page.nextCursor ?? undefined;
    } while (after !== undefined);
    return inquiries;
  }
}
