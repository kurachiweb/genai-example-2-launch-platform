import { inject, injectable } from 'inversify';

import {
  REPORT_REJECT_ACTION,
  REPORT_RESOLVE_ACTION,
  REPORT_STATUS_CHANGE_ACTION,
} from '../../../common-lib/admin/audit-actions/content-reporting.ts';
import {
  canChangeStatusManually,
  checkReportAdminReason,
  isClosedStatus,
  type ManualStatusChangeKind,
  manualStatusChangeKind,
  type ReportAdminAction,
  type ReportCaseStatus,
} from '../../../common-lib/reporting/report-case-rules.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import type {
  AuditLogRecorder,
  PreparedAuditEntry,
} from '../../../lib/core/admin/audit-log.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type {
  CaseClosing,
  ReportCaseClosingCommand,
  ReportCaseCommand,
  ReportCaseRecord,
  ReportCaseStatusChangeCommand,
  ReportCaseStore,
  ReportCaseWorkflow,
  ReportCaseWriter,
  ReportNotifier,
} from './ports.ts';
import {
  type ReportingErrorCode,
  reportAdminReasonRejectedError,
  reportingError,
  reportStatusUnchangedError,
} from './reporting-errors.ts';
import { REPORTING_TYPES } from './reporting-types.ts';

// 操作による完了は当事者へ通知し、手での完了は通知しないため、監査ログの詳細で区別する
type ClosingMode = 'operation' | 'manual';

interface AuditActionAndDetail {
  readonly action: string;
  readonly detail: Readonly<Record<string, string>>;
}

const STATUS_CHANGE_FAILURES: Readonly<
  Record<
    Exclude<Awaited<ReturnType<ReportCaseWriter['changeStatus']>>, 'committed'>,
    ReportingErrorCode
  >
> = Object.freeze({
  conflict: 'report_case_state_conflict',
  'open-case-exists': 'report_case_open_exists',
  'not-found': 'report_case_not_found',
});

const CLOSE_FAILURES: Readonly<
  Record<
    Exclude<Awaited<ReturnType<ReportCaseWriter['close']>>, 'committed'>,
    ReportingErrorCode
  >
> = Object.freeze({
  conflict: 'report_case_state_conflict',
  'not-found': 'report_case_not_found',
});

const logger = getAppLogger(['api', 'application', 'reporting']);

const validReasonOf = (
  action: ReportAdminAction,
  reason: string | undefined,
): string | undefined => {
  const check = checkReportAdminReason(action, reason);
  if (check !== 'ok') {
    throw reportAdminReasonRejectedError(check);
  }
  const normalized = trimWhiteSpace(reason ?? '');
  return normalized === '' ? undefined : normalized;
};

const requiredReasonOf = (
  action: 'resolve' | 'reject',
  reason: string,
): string => validReasonOf(action, reason) ?? '';

const closingAuditOf = (
  closing: Pick<CaseClosing, 'to' | 'resolution'>,
  mode: ClosingMode,
  fromStatus: ReportCaseStatus,
): AuditActionAndDetail =>
  closing.to === 'resolved'
    ? {
        action: REPORT_RESOLVE_ACTION.name,
        detail: { resolution: closing.resolution ?? 'none', mode, fromStatus },
      }
    : { action: REPORT_REJECT_ACTION.name, detail: { mode, fromStatus } };

const manualAuditOf = (
  kind: ManualStatusChangeKind,
  from: ReportCaseStatus,
  to: ReportCaseStatus,
): AuditActionAndDetail =>
  kind === 'close'
    ? closingAuditOf(
        to === 'resolved'
          ? { to, resolution: 'none' }
          : { to: 'rejected', resolution: null },
        'manual',
        from,
      )
    : {
        action: REPORT_STATUS_CHANGE_ACTION.name,
        detail: { fromStatus: from, toStatus: to },
      };

// 却下の通知は投稿者にも送り、対象への参照を消した案件では投稿者を引けないため送らなかった記録にする
const rejectionPosterNoticeOf = (
  record: ReportCaseRecord,
): CaseClosing['posterNotice'] =>
  record.targetOwnerUserId === null ? 'skipped' : 'pending';

@injectable()
export class DefaultReportCaseWorkflow implements Pick<
  ReportCaseWorkflow,
  'changeStatus' | 'resolveWithoutMeasure' | 'reject'
> {
  constructor(
    @inject(REPORTING_TYPES.ReportCaseStore)
    private readonly cases: ReportCaseStore,
    @inject(REPORTING_TYPES.ReportCaseWriter)
    private readonly writer: ReportCaseWriter,
    @inject(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
    private readonly auditLog: AuditLogRecorder,
    @inject(REPORTING_TYPES.ReportNotifier)
    private readonly notifier: ReportNotifier,
  ) {}

  // 手での変更は記録の訂正のため、完了した案件も変えられ、当事者へ通知せず措置も行わない
  async changeStatus(
    command: ReportCaseStatusChangeCommand,
  ): Promise<{ readonly status: ReportCaseStatus }> {
    const { caseId, from, to, at } = command;
    if (!canChangeStatusManually(from, to)) {
      throw reportStatusUnchangedError();
    }
    const kind = manualStatusChangeKind(from, to);
    const reason = validReasonOf(`status-${kind}`, command.reason);
    const record = await this.#find(caseId);
    if (record.status !== from) {
      throw reportingError('report_case_state_conflict');
    }
    const audit = this.#prepare(command, manualAuditOf(kind, from, to), reason);
    const result = await this.writer.changeStatus({
      caseId,
      from,
      to,
      reason,
      at,
      audit,
    });
    if (result !== 'committed') {
      throw reportingError(STATUS_CHANGE_FAILURES[result]);
    }
    this.#logCommitted(command, to);
    return { status: to };
  }

  async resolveWithoutMeasure(
    command: ReportCaseClosingCommand,
  ): Promise<{ readonly status: 'resolved' }> {
    const reason = requiredReasonOf('resolve', command.reason);
    const record = await this.#findOpen(command.caseId);
    await this.#closeAndNotify(command, record, {
      to: 'resolved',
      resolution: 'none',
      reason,
      posterNotice: 'none',
    });
    return { status: 'resolved' };
  }

  async reject(
    command: ReportCaseClosingCommand,
  ): Promise<{ readonly status: 'rejected' }> {
    const reason = requiredReasonOf('reject', command.reason);
    const record = await this.#findOpen(command.caseId);
    await this.#closeAndNotify(command, record, {
      to: 'rejected',
      resolution: null,
      reason,
      posterNotice: rejectionPosterNoticeOf(record),
    });
    return { status: 'rejected' };
  }

  async #find(caseId: string): Promise<ReportCaseRecord> {
    const record = await this.cases.find(caseId);
    if (record === undefined) {
      throw reportingError('report_case_not_found');
    }
    return record;
  }

  // 通知を伴う操作は未完了の案件でだけ行い、完了した案件は先に手で戻させる
  async #findOpen(caseId: string): Promise<ReportCaseRecord> {
    const record = await this.#find(caseId);
    if (isClosedStatus(record.status)) {
      throw reportingError('report_case_closed');
    }
    return record;
  }

  #prepare(
    command: ReportCaseCommand,
    { action, detail }: AuditActionAndDetail,
    reason: string | undefined,
  ): PreparedAuditEntry {
    return this.auditLog.prepare({
      operatorAdminId: command.operator.adminId,
      action,
      targetIds: [command.caseId],
      ...(reason === undefined ? {} : { reason }),
      detail,
      occurredAt: command.at,
    });
  }

  async #closeAndNotify(
    command: ReportCaseCommand,
    record: ReportCaseRecord,
    closing: Pick<CaseClosing, 'to' | 'resolution' | 'reason' | 'posterNotice'>,
  ): Promise<void> {
    const audit = this.#prepare(
      command,
      closingAuditOf(closing, 'operation', record.status),
      closing.reason,
    );
    const result = await this.writer.close({
      caseId: command.caseId,
      ...closing,
      at: command.at,
      audit,
    });
    if (result !== 'committed') {
      throw reportingError(CLOSE_FAILURES[result]);
    }
    this.#logCommitted(command, closing.to);
    await this.#notify(command.caseId);
  }

  #logCommitted(command: ReportCaseCommand, status: ReportCaseStatus): void {
    logger.info('通報の案件の対応ステータスを確定しました', {
      caseId: command.caseId,
      operatorAdminId: command.operator.adminId,
      status,
    });
  }

  // 完了は確定済みで、送れなかった通知は依頼待ちのまま日次の送り直しが拾うため、操作の結果は成功にする
  async #notify(caseId: string): Promise<void> {
    try {
      await this.notifier.dispatch(caseId);
    } catch (error: unknown) {
      logger.warning('通報の当事者への通知を依頼できませんでした', {
        caseId,
        error,
      });
    }
  }
}
