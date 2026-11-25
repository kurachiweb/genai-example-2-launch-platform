import { z } from 'zod';

import { REPORT_RESOLVE_ACTION } from '../../../common-lib/admin/audit-actions/content-reporting.ts';
import {
  checkReportAdminReason,
  REPORT_RESOLUTIONS,
  type ReportMeasure,
} from '../../../common-lib/reporting/report-case-rules.ts';
import type { ModerationWriteParticipation } from '../moderation/ports.ts';
import type { CaseClosing } from './ports.ts';

export const REPORT_CASE_CLOSING_PARTICIPATION =
  'content-reporting.report-case-closing';

export interface MeasureCaseClosing extends CaseClosing {
  readonly to: 'resolved';
  readonly resolution: ReportMeasure;
  readonly posterNotice: 'none';
}

const preparedAuditSchema = z.object({
  id: z.string().min(1),
  operatorAdminId: z.string().min(1),
  action: z.literal(REPORT_RESOLVE_ACTION.name),
  targetKind: z.literal(REPORT_RESOLVE_ACTION.targetKind),
  targetIds: z.array(z.string()),
  reason: z.string().nullable(),
  detail: z.record(z.string(), z.string()),
  occurredAt: z.date(),
});

// 参加者は値を文に変えるだけで読み直さないため、措置なしの完了・却下・別の案件の監査ログを含む値をここで拒む
const measureCaseClosingSchema = z
  .strictObject({
    caseId: z.string().min(1),
    to: z.literal('resolved'),
    resolution: z.enum(REPORT_RESOLUTIONS).exclude(['none']),
    reason: z
      .string()
      .refine((reason) => checkReportAdminReason('resolve', reason) === 'ok'),
    posterNotice: z.literal('none'),
    at: z.date(),
    audit: preparedAuditSchema,
  })
  .refine(
    ({ caseId, audit }) =>
      audit.targetIds.length === 1 && audit.targetIds[0] === caseId,
  );

export function toReportCaseClosingParticipation(
  closing: MeasureCaseClosing,
): ModerationWriteParticipation<MeasureCaseClosing> {
  const payload: MeasureCaseClosing = Object.freeze({
    caseId: closing.caseId,
    to: 'resolved',
    resolution: closing.resolution,
    reason: closing.reason,
    posterNotice: 'none',
    at: closing.at,
    audit: closing.audit,
  });
  return Object.freeze({ kind: REPORT_CASE_CLOSING_PARTICIPATION, payload });
}

export function readReportCaseClosingPayload(
  participation: ModerationWriteParticipation,
): MeasureCaseClosing | undefined {
  if (participation.kind !== REPORT_CASE_CLOSING_PARTICIPATION) {
    return undefined;
  }
  // 準備済みの監査ログの印は型だけのため、検証の結果ではなく渡された値を返す
  return measureCaseClosingSchema.safeParse(participation.payload).success
    ? (participation.payload as MeasureCaseClosing)
    : undefined;
}
