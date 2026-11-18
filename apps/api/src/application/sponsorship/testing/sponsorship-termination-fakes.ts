import type { AdminRole } from '../../../../common-lib/admin/admin-roles.ts';
import { createAuditActionCatalog } from '../../../../common-lib/admin/audit-action.ts';
import { AUDIT_ACTIONS } from '../../../../common-lib/admin/audit-actions/index.ts';
import type {
  AuditEntryInput,
  AuditLogRecorder,
} from '../../../../lib/core/admin/audit-log.ts';
import type { CurrentAdmin } from '../../../../lib/core/admin/current-admin.ts';
import type { AppError } from '../../../../lib/core/errors/app-error.ts';
import type {
  NoticeRequester,
  RefundEstimator,
  RefundOutcome,
  SponsorshipRecord,
  SponsorshipStore,
  TerminationEstimate,
} from '../../../../lib/core/sponsorship/ports.ts';
import type { BusinessDate } from '../../../../lib/core/time/business-time.ts';
import { StoreAuditLogRecorder } from '../../admin/audit-log-recorder.ts';
import type {
  SponsorshipTerminationWriter,
  TerminationCommitResult,
} from '../sponsorship-termination.ts';
import {
  NOW,
  PURCHASE_ID,
  sponsorshipRecordOf,
} from './sponsorship-application-fakes.ts';
import { CURRENT_ADMIN } from './sponsorship-reader-fakes.ts';

export const MODERATOR: CurrentAdmin = Object.freeze({
  ...CURRENT_ADMIN,
  role: 'moderator',
});

export const AUDIT_ENTRY_ID = '01JF0SPAUDT000000000000001';

export function paidRecordOf(
  overrides: Partial<SponsorshipRecord> = {},
): SponsorshipRecord {
  return sponsorshipRecordOf({
    state: 'paid',
    purchaseId: PURCHASE_ID,
    paymentRecordId: '01JF0SPPAYR000000000000001',
    amountTotal: 7000,
    paidAt: NOW,
    ...overrides,
  });
}

export const ESTIMATE: TerminationEstimate = Object.freeze({
  unexposedDays: 7,
  refundEstimate: 7000,
  stoppedDays: 0,
  stopRefundAmount: 0,
});

export function refundOutcomeOf(
  overrides: Partial<RefundOutcome> = {},
): RefundOutcome {
  return {
    kind: 'termination',
    days: 7,
    amount: 7000,
    status: 'requested',
    refundRequestId: '01JF0SPRFND000000000000001',
    ...overrides,
  };
}

export const COMMITTED: Extract<
  TerminationCommitResult,
  { readonly kind: 'committed' }
> = Object.freeze({
  kind: 'committed',
  termination: refundOutcomeOf(),
  displayStop: refundOutcomeOf({
    kind: 'display_stop',
    days: 0,
    amount: 0,
    status: 'not_needed',
    refundRequestId: null,
  }),
});

export type TerminationCall =
  | { readonly kind: 'requireRole'; readonly minimum: AdminRole }
  | { readonly kind: 'findById'; readonly id: string }
  | {
      readonly kind: 'estimateTermination';
      readonly record: SponsorshipRecord;
      readonly today: BusinessDate;
    }
  | { readonly kind: 'prepare'; readonly entry: AuditEntryInput }
  | {
      readonly kind: 'commit';
      readonly input: Parameters<SponsorshipTerminationWriter['commit']>[0];
    }
  | { readonly kind: 'request' };

export interface TerminationFakeOptions {
  readonly roleError?: AppError;
  // undefinedを明示すると申込が無い
  readonly record?: SponsorshipRecord | undefined;
  readonly estimate?: TerminationEstimate;
  readonly commitResult?: TerminationCommitResult;
  readonly noticeError?: Error;
}

export interface TerminationFakes {
  readonly calls: TerminationCall[];
  readonly requireRole: (minimum: AdminRole) => Promise<CurrentAdmin>;
  readonly store: SponsorshipStore;
  readonly estimator: RefundEstimator;
  readonly auditLog: AuditLogRecorder;
  readonly writer: SponsorshipTerminationWriter;
  readonly notices: NoticeRequester;
}

const unexpected = (): Promise<never> =>
  Promise.reject(new Error('呼ばれない想定です'));

export function createTerminationFakes(
  options: TerminationFakeOptions = {},
): TerminationFakes {
  const calls: TerminationCall[] = [];
  const record = 'record' in options ? options.record : paidRecordOf();
  const requireRole = (minimum: AdminRole): Promise<CurrentAdmin> => {
    calls.push({ kind: 'requireRole', minimum });
    return options.roleError === undefined
      ? Promise.resolve(MODERATOR)
      : Promise.reject(options.roleError);
  };
  const store: SponsorshipStore = {
    create: unexpected,
    findById: (id) => {
      calls.push({ kind: 'findById', id });
      return Promise.resolve(record);
    },
    hasPaidOverlap: unexpected,
    listPaidPeriods: unexpected,
    listByOwner: unexpected,
    listForAdmin: unexpected,
    countActiveForProduct: unexpected,
    deleteUnpaid: unexpected,
    deleteExpiredUnpaid: unexpected,
    listUnsettledEnded: unexpected,
  };
  const estimator: RefundEstimator = {
    estimateTermination: (target, today) => {
      calls.push({ kind: 'estimateTermination', record: target, today });
      return Promise.resolve(options.estimate ?? ESTIMATE);
    },
  };
  // 理由の必須・上限・トリムと詳細の項目の検証を実際の規則で確かめるため、登録済みの操作種別の一覧を持つ実装を使う
  const recorder = new StoreAuditLogRecorder(
    createAuditActionCatalog(AUDIT_ACTIONS),
    { generate: () => AUDIT_ENTRY_ID },
    {
      insert: unexpected,
      search: unexpected,
      latestFor: unexpected,
      latestForMany: unexpected,
      deleteOccurredUntil: unexpected,
    },
  );
  const auditLog: AuditLogRecorder = {
    prepare: (entry) => {
      calls.push({ kind: 'prepare', entry });
      return recorder.prepare(entry);
    },
    record: unexpected,
  };
  const writer: SponsorshipTerminationWriter = {
    commit: (input) => {
      calls.push({ kind: 'commit', input });
      return Promise.resolve(options.commitResult ?? COMMITTED);
    },
  };
  const notices: NoticeRequester = {
    request: () => {
      calls.push({ kind: 'request' });
      return options.noticeError === undefined
        ? Promise.resolve()
        : Promise.reject(options.noticeError);
    },
    requestSettlement: unexpected,
  };
  return { calls, requireRole, store, estimator, auditLog, writer, notices };
}
