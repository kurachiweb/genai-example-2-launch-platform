import {
  INQUIRY_RESPONSE_DAYS,
  isClosedStatus,
  type ReportCaseStatus,
} from '../../../common-lib/reporting/report-case-rules.ts';
import type { ResponseTimeAlert } from '../../../common-lib/reporting/report-labels.ts';

export type { ResponseTimeAlert };

const MILLISECONDS_PER_DAY = 86_400_000;

// 1営業日は土日・祝日を区別しない単純な24時間として数える
export const START_TARGET_MS = MILLISECONDS_PER_DAY;

export const DECISION_TARGET_MS = 9 * MILLISECONDS_PER_DAY;

const INQUIRY_RESPONSE_MS = INQUIRY_RESPONSE_DAYS * MILLISECONDS_PER_DAY;

export interface ResponseTimeInput {
  readonly startedAt: Date;
  readonly status: ReportCaseStatus;
  readonly completedAt: Date | undefined;
  readonly now: Date;
}

export interface ResponseTime {
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly elapsedMs: number | null;
  readonly alerts: readonly ResponseTimeAlert[];
}

function openResponseTime(input: ResponseTimeInput): ResponseTime {
  const elapsedMs = input.now.getTime() - input.startedAt.getTime();
  const alerts: ResponseTimeAlert[] = [
    ...(input.status === 'open' && elapsedMs > START_TARGET_MS
      ? (['start-overdue'] as const)
      : []),
    ...(elapsedMs > DECISION_TARGET_MS ? (['decision-overdue'] as const) : []),
  ];
  return {
    startedAt: input.startedAt,
    completedAt: null,
    elapsedMs,
    alerts,
  };
}

function closedResponseTime(
  startedAt: Date,
  completedAt: Date | undefined,
): ResponseTime {
  if (completedAt === undefined) {
    return { startedAt, completedAt: null, elapsedMs: null, alerts: [] };
  }
  const elapsedMs = completedAt.getTime() - startedAt.getTime();
  return {
    startedAt,
    completedAt,
    elapsedMs,
    alerts: elapsedMs > DECISION_TARGET_MS ? ['decision-overdue'] : [],
  };
}

// 完了から戻した案件は過去の完了の日時が渡されても未完了として現在までを数える
export function computeResponseTime(input: ResponseTimeInput): ResponseTime {
  return isClosedStatus(input.status)
    ? closedResponseTime(input.startedAt, input.completedAt)
    : openResponseTime(input);
}

export function inquiryDeadline(sentAt: Date): Date {
  return new Date(sentAt.getTime() + INQUIRY_RESPONSE_MS);
}

export function isInquiryOverdue(sentAt: Date, now: Date): boolean {
  return now.getTime() > inquiryDeadline(sentAt).getTime();
}
