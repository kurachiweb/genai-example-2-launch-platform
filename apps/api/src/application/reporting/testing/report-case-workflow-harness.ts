import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type {
  AuditEntryInput,
  AuditLogRecorder,
  PreparedAuditEntry,
} from '../../../../lib/core/admin/audit-log.ts';
import type { ReportMeasure } from '../../../../common-lib/reporting/report-case-rules.ts';
import { AppError } from '../../../../lib/core/errors/app-error.ts';
import type { CommentModerationService } from '../../moderation/comment-moderation-service.ts';
import type {
  ModerationCommand,
  ModerationOutcome,
} from '../../moderation/ports.ts';
import type { ProductModerationService } from '../../moderation/product-moderation-service.ts';
import type { UserModerationService } from '../../moderation/user-moderation-service.ts';
import type {
  CaseClosing,
  ReportCaseRecord,
  ReportCaseStatusChange,
  ReportCaseStore,
  ReportCaseWriter,
  ReportNotifier,
} from '../ports.ts';
import { DefaultReportCaseWorkflow } from '../report-case-workflow.ts';

export const CASE_ID = '01JQ0CAS000000000000000001';
export const OWNER_ID = '01JQ0USR000000000000000001';
export const PRODUCT_ID = '01JQ0PRD000000000000000001';
export const ADMIN_ID = '01JBX8Y4Z5ABCDEFGHJKMNPQRS';
export const AT = new Date('2027-03-20T12:00:00.000Z');
export const PREPARED_AUDIT_ID = '01JQ0AUD000000000000000001';
export const REASON = '利用規約に反する宣伝のため';

export const openCaseOf = (
  overrides: Partial<ReportCaseRecord> = {},
): ReportCaseRecord => ({
  caseId: CASE_ID,
  targetKind: 'product',
  targetId: PRODUCT_ID,
  targetDetachedAt: null,
  targetOwnerUserId: OWNER_ID,
  productId: PRODUCT_ID,
  status: 'open',
  statusChangedAt: new Date('2027-03-19T01:00:00.000Z'),
  infringementReportedAt: null,
  closedAt: null,
  resolution: null,
  closingReason: null,
  lastInquiredAt: null,
  lastInquiryMessage: null,
  reportCount: 1,
  firstReportedAt: new Date('2027-03-19T00:00:00.000Z'),
  lastReportedAt: new Date('2027-03-19T01:00:00.000Z'),
  categoryCounts: [],
  ...overrides,
});

export const closedCaseOf = (
  status: 'resolved' | 'rejected',
  overrides: Partial<ReportCaseRecord> = {},
): ReportCaseRecord =>
  openCaseOf({
    status,
    closedAt: new Date('2027-03-19T12:00:00.000Z'),
    resolution: status === 'resolved' ? 'none' : null,
    closingReason: '前の対応の理由',
    ...overrides,
  });

export const detachedCaseOf = (
  overrides: Partial<ReportCaseRecord> = {},
): ReportCaseRecord =>
  openCaseOf({
    targetId: null,
    targetDetachedAt: new Date('2027-03-19T06:00:00.000Z'),
    targetOwnerUserId: null,
    productId: null,
    ...overrides,
  });

export type StatusChangeResult = Awaited<
  ReturnType<ReportCaseWriter['changeStatus']>
>;
export type CloseResult = Awaited<ReturnType<ReportCaseWriter['close']>>;

export const MEASURE_ACTION_ID = '01JQ0MACT00000000000000001';

export interface WorkflowScenario {
  readonly caseRecord?: ReportCaseRecord | undefined;
  // 2回目以降の案件の照会の結果。省略すれば最初と同じ
  readonly reloadedCase?: ReportCaseRecord | undefined;
  readonly reloadError?: Error;
  readonly measureOutcome?: ModerationOutcome;
  readonly measureError?: Error;
  readonly statusChangeResult?: StatusChangeResult;
  readonly closeResult?: CloseResult;
  readonly writeError?: Error;
  readonly dispatchError?: Error;
}

export interface WorkflowHarness {
  readonly workflow: DefaultReportCaseWorkflow;
  readonly calls: string[];
  readonly found: string[];
  readonly prepared: AuditEntryInput[];
  readonly preparedEntries: PreparedAuditEntry[];
  readonly statusChanges: ReportCaseStatusChange[];
  readonly closings: CaseClosing[];
  readonly dispatched: string[];
  readonly measures: MeasureCall[];
}

export interface MeasureCall {
  readonly measure: ReportMeasure;
  readonly command: ModerationCommand;
}

const unused = (): never => {
  throw new Error('この試験では呼ばれない');
};

const caseStoreOf = (
  scenario: WorkflowScenario,
  calls: string[],
  found: string[],
): ReportCaseStore => {
  const first = 'caseRecord' in scenario ? scenario.caseRecord : openCaseOf();
  const reloaded = 'reloadedCase' in scenario ? scenario.reloadedCase : first;
  return {
    find: (caseId) => {
      calls.push('find');
      found.push(caseId);
      const isReload = found.length > 1;
      if (isReload && scenario.reloadError !== undefined) {
        return Promise.reject(scenario.reloadError);
      }
      const record = isReload ? reloaded : first;
      return Promise.resolve(record?.caseId === caseId ? record : undefined);
    },
    search: unused,
    listReports: unused,
    countUnhandled: unused,
    productSummary: unused,
  };
};

const measureOf =
  (
    measure: ReportMeasure,
    scenario: WorkflowScenario,
    calls: string[],
    measures: MeasureCall[],
  ) =>
  (command: ModerationCommand): Promise<ModerationOutcome> => {
    calls.push(measure);
    measures.push({ measure, command });
    if (scenario.measureError !== undefined) {
      return Promise.reject(scenario.measureError);
    }
    return Promise.resolve(
      scenario.measureOutcome ?? { changed: true, actionId: MEASURE_ACTION_ID },
    );
  };

const moderationOf = (
  scenario: WorkflowScenario,
  calls: string[],
  measures: MeasureCall[],
) => {
  const products: ProductModerationService = {
    hide: measureOf('product.hide', scenario, calls, measures),
    unhide: unused,
  };
  const comments: CommentModerationService = {
    hide: measureOf('comment.hide', scenario, calls, measures),
    unhide: unused,
  };
  const users: UserModerationService = {
    suspend: measureOf('user.suspend', scenario, calls, measures),
    unsuspend: unused,
  };
  return { products, comments, users };
};

// 準備済みの記録は記録の実装だけが作れるため、偽物は型の表明で作る。記録の検証そのものは監査ログのテストが確かめる
const auditLogOf = (
  calls: string[],
  prepared: AuditEntryInput[],
  preparedEntries: PreparedAuditEntry[],
): AuditLogRecorder => ({
  prepare: (entry) => {
    calls.push('prepare');
    prepared.push(entry);
    const result = Object.freeze({
      id: PREPARED_AUDIT_ID,
      operatorAdminId: entry.operatorAdminId,
      action: entry.action,
      targetKind: 'report',
      targetIds: entry.targetIds,
      reason: entry.reason ?? null,
      detail: entry.detail ?? {},
      occurredAt: entry.occurredAt,
    }) as PreparedAuditEntry;
    preparedEntries.push(result);
    return result;
  },
  record: unused,
});

const writerOf = (
  scenario: WorkflowScenario,
  calls: string[],
  statusChanges: ReportCaseStatusChange[],
  closings: CaseClosing[],
): ReportCaseWriter => ({
  changeStatus: (input) => {
    calls.push('changeStatus');
    statusChanges.push(input);
    if (scenario.writeError !== undefined) {
      return Promise.reject(scenario.writeError);
    }
    return Promise.resolve(scenario.statusChangeResult ?? 'committed');
  },
  close: (input) => {
    calls.push('close');
    closings.push(input);
    if (scenario.writeError !== undefined) {
      return Promise.reject(scenario.writeError);
    }
    return Promise.resolve(scenario.closeResult ?? 'committed');
  },
  recordInquiry: unused,
});

const notifierOf = (
  dispatchError: Error | undefined,
  calls: string[],
  dispatched: string[],
): ReportNotifier => ({
  dispatch: (caseId) => {
    calls.push('dispatch');
    dispatched.push(caseId);
    if (dispatchError !== undefined) {
      return Promise.reject(dispatchError);
    }
    return Promise.resolve({ requested: 1, skipped: 0 });
  },
});

export const setupWorkflow = (
  scenario: WorkflowScenario = {},
): WorkflowHarness => {
  const calls: string[] = [];
  const found: string[] = [];
  const prepared: AuditEntryInput[] = [];
  const preparedEntries: PreparedAuditEntry[] = [];
  const statusChanges: ReportCaseStatusChange[] = [];
  const closings: CaseClosing[] = [];
  const dispatched: string[] = [];
  const measures: MeasureCall[] = [];
  const moderation = moderationOf(scenario, calls, measures);
  const workflow = new DefaultReportCaseWorkflow(
    caseStoreOf(scenario, calls, found),
    writerOf(scenario, calls, statusChanges, closings),
    auditLogOf(calls, prepared, preparedEntries),
    notifierOf(scenario.dispatchError, calls, dispatched),
    moderation.products,
    moderation.comments,
    moderation.users,
  );
  return {
    workflow,
    calls,
    found,
    prepared,
    preparedEntries,
    statusChanges,
    closings,
    dispatched,
    measures,
  };
};

export async function appErrorOf(action: Promise<unknown>): Promise<AppError> {
  try {
    await action;
  } catch (error: unknown) {
    if (error instanceof AppError) {
      return error;
    }
    throw new Error('AppErrorで拒否される想定です', { cause: error });
  }
  throw new Error('例外が発生しませんでした。');
}

export async function rejectionOf(action: Promise<unknown>): Promise<unknown> {
  try {
    await action;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('例外が発生しませんでした。');
}

export const summaryOf = (error: AppError) => ({
  kind: error.kind,
  code: error.code,
  message: error.message,
  details: error.details,
});

export const CASE_NOT_FOUND = {
  kind: 'not_found',
  code: 'report_case_not_found',
  message: '通報の案件が見つかりません。',
  details: undefined,
} as const;

export const CASE_CLOSED = {
  kind: 'unprocessable',
  code: 'report_case_closed',
  message:
    'この案件は対応が完了しています。操作するには先に対応ステータスを戻してください。',
  details: undefined,
} as const;

export const STATE_CONFLICT = {
  kind: 'conflict',
  code: 'report_case_state_conflict',
  message:
    '他の操作で状態が変わりました。最新の内容を読み込んでからやり直してください。',
  details: undefined,
} as const;

export const MEASURE_ALREADY_APPLIED = {
  kind: 'unprocessable',
  code: 'report_measure_already_applied',
  message: '対象は既に非公開(停止中)です。措置なしで対応済にしてください。',
  details: undefined,
} as const;

export const TARGET_UNAVAILABLE = {
  kind: 'unprocessable',
  code: 'report_target_unavailable',
  message: '対象が見つかりません。措置なしで対応済にするか、却下してください。',
  details: undefined,
} as const;

export const OPEN_CASE_EXISTS = {
  kind: 'conflict',
  code: 'report_case_open_exists',
  message:
    'この対象には未完了の別の案件があります。その案件で対応してください。',
  details: undefined,
} as const;

export const reasonRejected = (code: 'required' | 'too-long') => ({
  kind: 'bad_request' as const,
  code: 'validation_error',
  message: '入力内容を確認してください。',
  details: [
    {
      field: 'reason',
      code,
      message:
        code === 'required'
          ? '理由を入力してください。'
          : '理由は500文字以内で入力してください。',
    },
  ],
});

export const LOG_CATEGORY = 'api.application.reporting';

// 呼び出し側のbeforeEach・afterEachで開始と終了を呼ぶ
export const captureLogs = () => {
  const logs: LogRecord[] = [];
  return {
    start: () => {
      logs.length = 0;
      configureSync({
        reset: true,
        sinks: {
          capture: (record) => {
            logs.push(record);
          },
        },
        loggers: [
          { category: ['api'], sinks: ['capture'], lowestLevel: 'debug' },
          { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
        ],
      });
    },
    stop: () => {
      resetSync();
    },
    records: () =>
      logs
        .filter((record) => record.category.join('.') === LOG_CATEGORY)
        .map(({ level, properties }) => ({ level, properties })),
  };
};
