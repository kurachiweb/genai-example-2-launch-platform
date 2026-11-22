import {
  REPORT_REJECT_ACTION,
  REPORT_RESOLVE_ACTION,
} from '../../../../common-lib/admin/audit-actions/content-reporting.ts';
import type {
  UserContact,
  UserContactDirectory,
} from '../../../../lib/core/identity/ports.ts';
import type {
  UserLookupScope,
  UserProfileDirectory,
  UserSummaryRecord,
} from '../../../../lib/core/profile/ports.ts';
import type {
  AuditLogLatestManyQuery,
  AuditLogLatestQuery,
} from '../../admin/audit-log-reader.ts';
import { createFakeAuditLogReader } from '../../admin/testing/fake-audit-log-reader.ts';
import type {
  ProductReportSummary,
  ReportCaseFilter,
  ReportCaseRecord,
  ReportCaseReportRecord,
  ReportCaseStore,
  ReportTargetKey,
  ReportTargetResolver,
  ReportTargetView,
  UnhandledReportCount,
} from '../ports.ts';
import { DefaultReportCaseReader } from '../report-case-reader.ts';
import {
  reportTargetKeyOf,
  UNAVAILABLE_TARGET_VIEW,
} from '../report-target-resolver.ts';

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

export const NOW = new Date('2027-03-20T12:00:00.000Z');

export const ago = (ms: number): Date => new Date(NOW.getTime() - ms);

export const OWNER_ID = '01JQ0USR000000000000000001';
export const PRODUCT_ID = '01JQ0PRD000000000000000001';
export const CATEGORY_ID = '01JF000000000000000000SPAM';

export const caseOf = (
  overrides: Partial<ReportCaseRecord> = {},
): ReportCaseRecord => ({
  caseId: '01JQ0CAS000000000000000001',
  targetKind: 'product',
  targetId: PRODUCT_ID,
  targetDetachedAt: null,
  targetOwnerUserId: OWNER_ID,
  productId: PRODUCT_ID,
  status: 'open',
  statusChangedAt: ago(5 * HOUR_MS),
  infringementReportedAt: null,
  closedAt: null,
  resolution: null,
  closingReason: null,
  lastInquiredAt: null,
  lastInquiryMessage: null,
  reportCount: 2,
  firstReportedAt: ago(6 * HOUR_MS),
  lastReportedAt: ago(5 * HOUR_MS),
  categoryCounts: [{ categoryId: CATEGORY_ID, name: 'スパム', count: 2 }],
  ...overrides,
});

export const reportOf = (
  overrides: Partial<ReportCaseReportRecord> = {},
): ReportCaseReportRecord => ({
  reportId: '01JQ0REP000000000000000001',
  categoryId: CATEGORY_ID,
  categoryName: 'スパム',
  reason: '宣伝の投稿が続いています',
  reportedAt: ago(6 * HOUR_MS),
  reporterUserId: null,
  hasContact: false,
  ...overrides,
});

export const UNAVAILABLE_VIEW: ReportTargetView = UNAVAILABLE_TARGET_VIEW;

export const viewOf = (label: string): ReportTargetView => ({
  ...UNAVAILABLE_VIEW,
  available: true,
  handle: `${label}-handle`,
  label,
});

export const keyOf = (record: ReportCaseRecord): string =>
  reportTargetKeyOf({ kind: record.targetKind, targetId: record.targetId });

const contactOf = (userId: string): UserContact => ({
  userId,
  email: 'owner@mail.example',
  nickname: '投稿したひと',
  emailVerified: true,
});

export interface ReportCaseReaderFakeOptions {
  readonly cases?: readonly ReportCaseRecord[];
  readonly nextCursor?: string | null;
  readonly reports?: readonly ReportCaseReportRecord[];
  readonly views?: ReadonlyMap<string, ReportTargetView>;
  readonly resolvedAt?: ReadonlyMap<string, Date>;
  readonly rejectedAt?: ReadonlyMap<string, Date>;
  readonly reporters?: readonly UserSummaryRecord[];
  // 宛先がある利用者のID
  readonly contacts?: readonly string[];
  readonly unhandled?: UnhandledReportCount;
  readonly productSummary?: ProductReportSummary;
}

const unexpected = (name: string) => () =>
  Promise.reject(new Error(`${name}は呼ばれない想定です`));

const pickDates = (
  dates: ReadonlyMap<string, Date>,
  ids: readonly string[],
): ReadonlyMap<string, Date> =>
  new Map(
    ids.flatMap((id): [string, Date][] => {
      const date = dates.get(id);
      return date === undefined ? [] : [[id, date]];
    }),
  );

export function setupReportCaseReader(
  options: ReportCaseReaderFakeOptions = {},
) {
  const calls: string[] = [];
  const searches: {
    readonly filter: ReportCaseFilter;
    readonly page: { readonly after?: string; readonly limit: number };
  }[] = [];
  const describes: (readonly ReportTargetKey[])[] = [];
  const manyLookups: AuditLogLatestManyQuery[] = [];
  const singleLookups: AuditLogLatestQuery[] = [];
  const summaryLookups: {
    readonly ids: readonly string[];
    readonly scope: UserLookupScope;
  }[] = [];
  const contactLookups: string[] = [];
  const productLookups: string[] = [];
  const cases = options.cases ?? [caseOf()];
  const datesOf = (action: string): ReadonlyMap<string, Date> => {
    if (action === REPORT_RESOLVE_ACTION.name) {
      return options.resolvedAt ?? new Map();
    }
    return action === REPORT_REJECT_ACTION.name
      ? (options.rejectedAt ?? new Map())
      : new Map();
  };

  const store: ReportCaseStore = {
    search: (filter, page) => {
      calls.push('store.search');
      searches.push({ filter, page });
      return Promise.resolve({
        items: cases,
        nextCursor: options.nextCursor ?? null,
      });
    },
    find: (caseId) => {
      calls.push('store.find');
      return Promise.resolve(cases.find((record) => record.caseId === caseId));
    },
    listReports: () => {
      calls.push('store.listReports');
      return Promise.resolve(options.reports ?? [reportOf()]);
    },
    countUnhandled: () => {
      calls.push('store.countUnhandled');
      return Promise.resolve(
        options.unhandled ?? { open: 0, infringementOpen: 0 },
      );
    },
    productSummary: (productId) => {
      calls.push('store.productSummary');
      productLookups.push(productId);
      return Promise.resolve(
        options.productSummary ?? { reportCount: 0, openCase: null },
      );
    },
  };
  const targets: ReportTargetResolver = {
    resolveForSubmission: unexpected('resolveForSubmission'),
    describe: (keys) => {
      calls.push('targets.describe');
      describes.push(keys);
      return Promise.resolve(options.views ?? new Map());
    },
  };
  const auditLogs = createFakeAuditLogReader({
    latestFor: (input) => {
      calls.push(`audit.latestFor:${input.action}`);
      singleLookups.push(input);
      return Promise.resolve(datesOf(input.action).get(input.targetId));
    },
    latestForMany: (input) => {
      calls.push(`audit.latestForMany:${input.action}`);
      manyLookups.push(input);
      return Promise.resolve(pickDates(datesOf(input.action), input.targetIds));
    },
  });
  const profiles: UserProfileDirectory = {
    findSummaries: (ids, scope) => {
      calls.push('profiles.findSummaries');
      summaryLookups.push({ ids, scope });
      return Promise.resolve(
        new Map(
          (options.reporters ?? [])
            .filter((user) => ids.includes(user.userId))
            .map((user): [string, UserSummaryRecord] => [user.userId, user]),
        ),
      );
    },
    resolveHandle: unexpected('resolveHandle'),
  };
  const contacts: UserContactDirectory = {
    findContact: (userId) => {
      calls.push('contacts.findContact');
      contactLookups.push(userId);
      return Promise.resolve(
        (options.contacts ?? []).includes(userId)
          ? contactOf(userId)
          : undefined,
      );
    },
  };
  const reader = new DefaultReportCaseReader(
    store,
    targets,
    auditLogs,
    profiles,
    contacts,
  );
  return {
    reader,
    calls,
    searches,
    describes,
    manyLookups,
    singleLookups,
    summaryLookups,
    contactLookups,
    productLookups,
  };
}
