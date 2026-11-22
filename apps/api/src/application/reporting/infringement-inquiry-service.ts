import { inject, injectable } from 'inversify';

import { REPORT_INQUIRE_ACTION } from '../../../common-lib/admin/audit-actions/content-reporting.ts';
import {
  checkInquiryMessage,
  checkReportAdminReason,
  isClosedStatus,
  REPORT_NOTICE_EXCERPT_MAX,
} from '../../../common-lib/reporting/report-case-rules.ts';
import { truncateGraphemes } from '../../../common-lib/text/graphemes.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import type { AuditLogRecorder } from '../../../lib/core/admin/audit-log.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { EMAIL_TYPES } from '../../../lib/core/email/identifiers.ts';
import {
  REPORT_INFRINGEMENT_INQUIRY_EMAIL,
  type ReportInfringementInquiryInput,
} from '../../../lib/core/email/kinds/content-reporting.ts';
import {
  EmailSendError,
  type EmailSender,
} from '../../../lib/core/email/ports.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import type { UserContactDirectory } from '../../../lib/core/identity/ports.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { inquiryDeadline } from '../../../lib/core/reporting/response-time.ts';
import type {
  InfringementInquiryCommand,
  InfringementInquiryService,
  ReportCaseRecord,
  ReportCaseStore,
  ReportCaseWriter,
  ReportIncidentReporter,
  ReportTargetKey,
  ReportTargetResolver,
  ReportTargetView,
} from './ports.ts';
import { inquiryTargetPathOf } from './inquiry-target.ts';
import { reportTargetKeyOf } from './report-target-resolver.ts';
import {
  inquiryMessageRejectedError,
  reportAdminReasonRejectedError,
  reportingError,
} from './reporting-errors.ts';
import { REPORTING_TYPES } from './reporting-types.ts';

export interface InfringementInquiryEnv {
  readonly CLIENT_SITE_ORIGIN: string;
}

interface InquiryTarget {
  readonly key: ReportTargetKey & { readonly targetId: string };
  readonly ownerUserId: string;
}

type InquiryTargetInput = Pick<
  ReportInfringementInquiryInput,
  'targetKind' | 'targetLabel' | 'excerpt' | 'targetUrl'
>;

const CONTACT_PATH = '/contact';

const logger = getAppLogger(['api', 'application', 'reporting']);

const validMessageOf = (message: string): string => {
  const check = checkInquiryMessage(message);
  if (check !== 'ok') {
    throw inquiryMessageRejectedError(check);
  }
  return trimWhiteSpace(message);
};

const validReasonOf = (reason: string | undefined): string | undefined => {
  const check = checkReportAdminReason('inquire', reason);
  if (check !== 'ok') {
    throw reportAdminReasonRejectedError(check);
  }
  const normalized = trimWhiteSpace(reason ?? '');
  return normalized === '' ? undefined : normalized;
};

const inquiryTargetOf = (record: ReportCaseRecord): InquiryTarget => {
  if (isClosedStatus(record.status)) {
    throw reportingError('report_case_closed');
  }
  const { targetId, targetOwnerUserId } = record;
  if (
    record.infringementReportedAt === null ||
    record.status !== 'in_progress' ||
    targetId === null ||
    targetOwnerUserId === null
  ) {
    throw reportingError('report_inquiry_not_applicable');
  }
  return {
    key: { kind: record.targetKind, targetId, productId: record.productId },
    ownerUserId: targetOwnerUserId,
  };
};

// 抜粋が空になる本文の無いコメントは、テンプレートが抜粋を描かないようnullにする
const noticeExcerptOf = (excerpt: string | null): string | null => {
  const truncated =
    excerpt === null
      ? ''
      : truncateGraphemes(excerpt, REPORT_NOTICE_EXCERPT_MAX);
  return truncated === '' ? null : truncated;
};

const targetInputOf = (
  key: ReportTargetKey,
  view: ReportTargetView | undefined,
  origin: string,
): InquiryTargetInput | undefined => {
  const path = inquiryTargetPathOf(key.kind, view);
  if (view === undefined || path === undefined) {
    return undefined;
  }
  const targetUrl = new URL(path, origin).href;
  return key.kind === 'comment'
    ? {
        targetKind: key.kind,
        targetLabel: view.productName,
        excerpt: noticeExcerptOf(view.excerpt),
        targetUrl,
      }
    : {
        targetKind: key.kind,
        targetLabel: view.label,
        excerpt: null,
        targetUrl,
      };
};

@injectable()
export class DefaultInfringementInquiryService implements InfringementInquiryService {
  constructor(
    @inject(REPORTING_TYPES.ReportCaseStore)
    private readonly cases: ReportCaseStore,
    @inject(REPORTING_TYPES.ReportCaseWriter)
    private readonly writer: ReportCaseWriter,
    @inject(REPORTING_TYPES.ReportTargetResolver)
    private readonly targets: ReportTargetResolver,
    @inject(IDENTITY_PLATFORM_TYPES.UserContactDirectory)
    private readonly contacts: UserContactDirectory,
    @inject(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
    private readonly auditLog: AuditLogRecorder,
    @inject(EMAIL_TYPES.EmailSender) private readonly emails: EmailSender,
    @inject(REPORTING_TYPES.ReportIncidentReporter)
    private readonly incidents: ReportIncidentReporter,
    @inject(PLATFORM_TYPES.Env) private readonly env: InfringementInquiryEnv,
  ) {}

  async send(
    command: InfringementInquiryCommand,
  ): Promise<{ readonly sentAt: Date; readonly deadline: Date }> {
    const message = validMessageOf(command.message);
    const reason = validReasonOf(command.reason);
    const { caseId, at } = command;
    const record = await this.cases.find(caseId);
    if (record === undefined) {
      throw reportingError('report_case_not_found');
    }
    const target = inquiryTargetOf(record);
    const contact = await this.contacts.findContact(target.ownerUserId);
    if (contact === undefined) {
      throw reportingError('report_inquiry_not_applicable');
    }
    const views = await this.targets.describe([target.key]);
    const targetInput = targetInputOf(
      target.key,
      views.get(reportTargetKeyOf(target.key)),
      this.env.CLIENT_SITE_ORIGIN,
    );
    if (targetInput === undefined) {
      throw reportingError('report_inquiry_not_applicable');
    }
    const operatorAdminId = command.operator.adminId;
    const audit = this.auditLog.prepare({
      operatorAdminId,
      action: REPORT_INQUIRE_ACTION.name,
      targetIds: [caseId],
      ...(reason === undefined ? {} : { reason }),
      occurredAt: at,
    });
    const deadline = inquiryDeadline(at);
    await this.#request(
      caseId,
      {
        nickname: contact.nickname,
        ...targetInput,
        message,
        sentAt: at.toISOString(),
        deadline: deadline.toISOString(),
        contactUrl: new URL(CONTACT_PATH, this.env.CLIENT_SITE_ORIGIN).href,
      },
      contact.email,
    );
    await this.#record(caseId, { caseId, message, at, audit });
    logger.info('権利侵害の照会を送りました', { caseId, operatorAdminId });
    return { sentAt: at, deadline };
  }

  // 送り直しのジョブが無く管理者がその都度送るため、冪等のキーを付けない
  async #request(
    caseId: string,
    input: ReportInfringementInquiryInput,
    to: string,
  ): Promise<void> {
    try {
      await this.emails.send({
        kind: REPORT_INFRINGEMENT_INQUIRY_EMAIL,
        to,
        input,
      });
    } catch (error: unknown) {
      // 送信の要求の不備は呼び出し側の不具合のため、想定内の失敗として返さない
      if (error instanceof EmailSendError) {
        throw error;
      }
      logger.warning('権利侵害の照会のメールを依頼できませんでした', {
        caseId,
        error,
      });
      throw reportingError('report_inquiry_send_failed');
    }
  }

  // メールは依頼済みのため、記録の失敗は運用者へ知らせ、管理者が読み直して送り直せる失敗として返す
  async #record(
    caseId: string,
    input: Parameters<ReportCaseWriter['recordInquiry']>[0],
  ): Promise<void> {
    let result: Awaited<ReturnType<ReportCaseWriter['recordInquiry']>>;
    try {
      result = await this.writer.recordInquiry(input);
    } catch (error: unknown) {
      logger.error(
        '権利侵害の照会のメールを依頼した後に、照会を記録できませんでした',
        { caseId, error },
      );
      this.incidents.report('inquiry-record-failed', { caseId });
      throw reportingError('report_case_state_conflict');
    }
    if (result === 'committed') {
      return;
    }
    logger.error(
      '権利侵害の照会のメールを依頼した後に、案件の状態が変わっていたため照会を記録できませんでした',
      { caseId, result },
    );
    this.incidents.report('inquiry-record-failed', { caseId });
    throw reportingError(
      result === 'not-found'
        ? 'report_case_not_found'
        : 'report_case_state_conflict',
    );
  }
}
