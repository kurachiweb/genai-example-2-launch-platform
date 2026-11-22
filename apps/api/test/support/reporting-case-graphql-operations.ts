import { eq } from 'drizzle-orm';
import { ContainerModule } from 'inversify';
import { afterEach, beforeEach, vi } from 'vitest';

import type { AdminRole } from '../../common-lib/admin/admin-roles.ts';
import {
  REPORT_CATEGORY_INFRINGEMENT_ID,
  REPORT_CATEGORY_INFRINGEMENT_NAME,
} from '../../common-lib/reporting/report-rules.ts';
import { products } from '../../db/schema/product/products.ts';
import { reportCases } from '../../db/schema/reporting/report-cases.ts';
import { reports } from '../../db/schema/reporting/reports.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import { EMAIL_TYPES } from '../../lib/core/email/identifiers.ts';
import type {
  EmailSender,
  EmailSendRequest,
} from '../../lib/core/email/ports.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import {
  clearEngagementTables,
  commentIdOf,
  insertComment,
  insertLaunch,
  insertProduct,
  insertUser,
  productIdOf,
  userIdOf,
} from '../../lib/workers/engagement/testing/engagement-fixtures.ts';
import type { MessagePublisher } from '../../lib/workers/messaging/queue-publisher.ts';
import type { ReportCaseStore } from '../../src/application/reporting/ports.ts';
import { REPORTING_TYPES } from '../../src/application/reporting/reporting-types.ts';
import {
  adminIdOf,
  clearAdminTables,
  insertAdmin,
} from '../../src/infrastructure/admin/testing/admin-store-fixtures.ts';
import { clearModerationWrites } from '../../src/infrastructure/moderation/testing/moderation-write-fixtures.ts';
import { D1ReportCaseStore } from '../../src/infrastructure/reporting/d1-report-case-store.ts';
import {
  type CaseRow,
  caseIdOf,
  clearReportCaseWrites,
  db,
  detachedColumns,
  guestReportOf,
  insertReporter,
  memberReportOf,
  openCaseOf,
  rejectedColumns,
  seed,
  T0,
} from '../../src/infrastructure/reporting/testing/report-case-write-fixtures.ts';
import { reportingSchemaModule } from '../../src/presentation/graphql/modules/reporting/index.ts';
import { issueAdminSession } from './admin-graphql-harness.ts';
import {
  createGraphQLGateway,
  type GatewayApp,
  type GatewayCallOptions,
  type GatewayResponse,
} from './graphql-gateway.ts';

export { codesOf, detailsOf } from './payments-graphql-operations.ts';

// 案件の照会の対応期間と照会の期限を予測できるよう、現在時刻を固定する
export const REPORT_CASE_TEST_NOW = new Date('2026-11-23T10:00:00.000Z');

export const HOUR_MS = 3_600_000;

export const INQUIRY_RESPONSE_MS = 7 * 24 * HOUR_MS;

export const hoursAfterT0 = (hours: number): Date =>
  new Date(T0.getTime() + hours * HOUR_MS);

export const OWNER = 1;
export const AUTHOR = 2;
export const REPORTER = 1;
export const PRODUCT = 1;
export const COMMENT = 1;

export const PRODUCT_CASE = 1;
export const COMMENT_CASE = 2;
export const USER_CASE = 3;
export const DETACHED_CASE = 4;
export const MISSING_CASE_ID = caseIdOf(99);

export const OWNER_EMAIL = 'user1@mail.example';
export const LAST_INQUIRY_MESSAGE = '前回の照会の内容';
export const REASON = '通報の内容を確認したため';
export const INQUIRY_MESSAGE =
  '権利の侵害の申し出について、ご確認をお願いします。';

const ADMINS = Object.freeze({ superAdmin: 1, moderator: 2, viewer: 3 });

const ADMIN_ROLES: readonly (readonly [number, AdminRole])[] = [
  [ADMINS.superAdmin, 'super_admin'],
  [ADMINS.moderator, 'moderator'],
  [ADMINS.viewer, 'viewer'],
];

const CASE_SELECTION = /* GraphQL */ `
  id
  target {
    kind
    id
    detached
    available
    handle
    label
    excerpt
    productId
    productName
    productHandle
  }
  status
  reportCount
  categoryCounts {
    categoryId
    name
    count
  }
  firstReportedAt
  lastReportedAt
  infringement
  responseTime {
    startedAt
    completedAt
    elapsedSeconds
    alerts
  }
`;

export const ADMIN_REPORT_CASES = /* GraphQL */ `
  query AdminReportCases(
    $filter: AdminReportCaseFilter
    $first: Int!
    $after: String
  ) {
    adminReportCases(filter: $filter, first: $first, after: $after) {
      nodes { ${CASE_SELECTION} }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const ADMIN_REPORT_CASE = /* GraphQL */ `
  query AdminReportCase($id: ID!) {
    adminReportCase(id: $id) {
      case { ${CASE_SELECTION} }
      statusChangedAt
      resolution
      closingReason
      closedAt
      lastInquiry {
        sentAt
        message
        deadline
        overdue
      }
      inquiryAvailable
      reports {
        id
        categoryName
        reason
        reportedAt
        reporter {
          kind
          nickname
          handle
          hasContact
        }
      }
    }
  }
`;

export const CHANGE_STATUS = /* GraphQL */ `
  mutation ChangeReportCaseStatus(
    $id: ID!
    $from: ReportCaseStatus!
    $to: ReportCaseStatus!
    $reason: String
  ) {
    changeReportCaseStatus(id: $id, from: $from, to: $to, reason: $reason) {
      status
    }
  }
`;

const closingMutation = (operation: string, field: string) => /* GraphQL */ `
  mutation ${operation}($id: ID!, $reason: String!) {
    ${field}(id: $id, reason: $reason) {
      status
    }
  }
`;

export const RESOLVE_WITH_MEASURE = closingMutation(
  'ResolveReportCaseWithMeasure',
  'resolveReportCaseWithMeasure',
);

export const RESOLVE_WITHOUT_MEASURE = closingMutation(
  'ResolveReportCaseWithoutMeasure',
  'resolveReportCaseWithoutMeasure',
);

export const REJECT = closingMutation('RejectReportCase', 'rejectReportCase');

export const SEND_INQUIRY = /* GraphQL */ `
  mutation SendInfringementInquiry(
    $id: ID!
    $message: String!
    $reason: String
  ) {
    sendInfringementInquiry(id: $id, message: $message, reason: $reason) {
      sentAt
      deadline
    }
  }
`;

export interface ReportCaseOperation {
  readonly name: string;
  readonly document: string;
  readonly variables: (id: string) => Record<string, unknown>;
  readonly invalid: Record<string, unknown>;
}

export const REPORT_CASE_QUERIES: readonly ReportCaseOperation[] = [
  {
    name: 'adminReportCases',
    document: ADMIN_REPORT_CASES,
    variables: () => ({ first: 10 }),
    invalid: { first: 0 },
  },
  {
    name: 'adminReportCase',
    document: ADMIN_REPORT_CASE,
    variables: (id) => ({ id }),
    invalid: { id: 'not-a-ulid' },
  },
];

export const REPORT_CASE_OPERATIONS: readonly ReportCaseOperation[] = [
  {
    name: 'changeReportCaseStatus',
    document: CHANGE_STATUS,
    variables: (id) => ({ id, from: 'IN_PROGRESS', to: 'OPEN' }),
    invalid: { id: 'not-a-ulid', from: 'OPEN', to: 'IN_PROGRESS' },
  },
  {
    name: 'resolveReportCaseWithMeasure',
    document: RESOLVE_WITH_MEASURE,
    variables: (id) => ({ id, reason: REASON }),
    invalid: { id: 'not-a-ulid', reason: REASON },
  },
  {
    name: 'resolveReportCaseWithoutMeasure',
    document: RESOLVE_WITHOUT_MEASURE,
    variables: (id) => ({ id, reason: REASON }),
    invalid: { id: 'not-a-ulid', reason: REASON },
  },
  {
    name: 'rejectReportCase',
    document: REJECT,
    variables: (id) => ({ id, reason: REASON }),
    invalid: { id: 'not-a-ulid', reason: REASON },
  },
  {
    name: 'sendInfringementInquiry',
    document: SEND_INQUIRY,
    variables: (id) => ({ id, message: INQUIRY_MESSAGE }),
    invalid: { id: 'not-a-ulid', message: INQUIRY_MESSAGE },
  },
];

const sentEmails: EmailSendRequest<unknown>[] = [];

const emailFailure: { error: Error | undefined } = { error: undefined };

// 照会と完了の通知を送らずに記録し、指定したときだけ送信の依頼を失敗させる
const recordingEmailSender: EmailSender = {
  send: <TInput>(request: EmailSendRequest<TInput>) => {
    if (emailFailure.error !== undefined) {
      return Promise.reject(emailFailure.error);
    }
    sentEmails.push(request);
    return Promise.resolve(crypto.randomUUID());
  },
};

export function readSentEmailRecipients(): readonly string[] {
  return sentEmails.map(({ to }) => to);
}

export function failEmailSending(error: Error): void {
  emailFailure.error = error;
}

async function purgeCase(caseId: string): Promise<void> {
  await db.delete(reports).where(eq(reports.caseId, caseId));
  await db.delete(reportCases).where(eq(reportCases.id, caseId));
}

const purgeAfterFind: { caseId: string | undefined } = { caseId: undefined };

// 次に操作がその案件を読んだ直後に物理削除し、読んだ後に案件が消えた状態を再現する
export function purgeCaseAfterNextFind(caseId: string): void {
  purgeAfterFind.caseId = caseId;
}

function purgingCaseStore(store: ReportCaseStore): ReportCaseStore {
  return {
    search: (filter, page) => store.search(filter, page),
    find: async (caseId) => {
      const record = await store.find(caseId);
      if (purgeAfterFind.caseId === caseId) {
        purgeAfterFind.caseId = undefined;
        await purgeCase(caseId);
      }
      return record;
    },
    listReports: (caseId) => store.listReports(caseId),
    countUnhandled: () => store.countUnhandled(),
    productSummary: (productId) => store.productSummary(productId),
  };
}

const testClock: Clock = { now: () => REPORT_CASE_TEST_NOW };

const overridesModule: AppModule<GatewayApp> = {
  name: 'reporting-case-graphql-test-overrides',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(testClock);
    rebind<MessagePublisher>(PLATFORM_TYPES.MessagePublisher).toConstantValue({
      publish: () => Promise.resolve(crypto.randomUUID()),
    });
    rebind<EmailSender>(EMAIL_TYPES.EmailSender).toConstantValue(
      recordingEmailSender,
    );
    rebind<ReportCaseStore>(REPORTING_TYPES.ReportCaseStore).toConstantValue(
      purgingCaseStore(new D1ReportCaseStore(db)),
    );
  }),
};

const gateway = createGraphQLGateway({
  documents: [
    ADMIN_REPORT_CASES,
    ADMIN_REPORT_CASE,
    CHANGE_STATUS,
    RESOLVE_WITH_MEASURE,
    RESOLVE_WITHOUT_MEASURE,
    REJECT,
    SEND_INQUIRY,
  ],
  schemaModules: [reportingSchemaModule],
  overrides: [overridesModule],
});

const sessionTokens = new Map<number, string>();

function asAdmin(index: number): GatewayCallOptions {
  const sessionToken = sessionTokens.get(index);
  if (sessionToken === undefined) {
    throw new Error(`管理者${String(index)}のセッションがありません`);
  }
  return { caller: 'admin', sessionToken };
}

export const asSuperAdmin = (): GatewayCallOptions =>
  asAdmin(ADMINS.superAdmin);

export const asModerator = (): GatewayCallOptions => asAdmin(ADMINS.moderator);

export const asViewer = (): GatewayCallOptions => asAdmin(ADMINS.viewer);

export const PRODUCT_TARGET: Partial<CaseRow> = Object.freeze({
  targetKind: 'product',
  targetId: productIdOf(PRODUCT),
  targetOwnerUserId: userIdOf(OWNER),
  productId: productIdOf(PRODUCT),
});

// 1: 権利侵害の対応中のプロダクト(前回の照会あり) / 2: 未対応のコメント / 3: 却下したユーザー / 4: 対象への参照を消した未対応の案件
async function seedCases(): Promise<void> {
  await insertReporter(REPORTER);
  await seed(
    [
      openCaseOf(PRODUCT_CASE, {
        ...PRODUCT_TARGET,
        status: 'in_progress',
        statusChangedAt: hoursAfterT0(1),
        infringementReportedAt: T0,
        lastReportedAt: hoursAfterT0(3),
        lastInquiredAt: hoursAfterT0(1),
        lastInquiryMessage: LAST_INQUIRY_MESSAGE,
      }),
      openCaseOf(COMMENT_CASE, {
        targetKind: 'comment',
        targetId: commentIdOf(COMMENT),
        targetOwnerUserId: userIdOf(AUTHOR),
        productId: productIdOf(PRODUCT),
        lastReportedAt: hoursAfterT0(2),
      }),
      openCaseOf(USER_CASE, {
        targetKind: 'user',
        targetId: userIdOf(OWNER),
        targetOwnerUserId: userIdOf(OWNER),
        productId: null,
        lastReportedAt: hoursAfterT0(1),
        ...rejectedColumns(),
      }),
      openCaseOf(DETACHED_CASE, { ...detachedColumns(), lastReportedAt: T0 }),
    ],
    [
      memberReportOf(1, PRODUCT_CASE, REPORTER, {
        categoryId: REPORT_CATEGORY_INFRINGEMENT_ID,
        categoryName: REPORT_CATEGORY_INFRINGEMENT_NAME,
      }),
      guestReportOf(2, PRODUCT_CASE, { reportedAt: hoursAfterT0(3) }),
      guestReportOf(3, COMMENT_CASE, {
        contactEmail: null,
        reportedAt: hoursAfterT0(2),
      }),
      memberReportOf(4, USER_CASE, REPORTER, { reportedAt: hoursAfterT0(1) }),
      guestReportOf(5, DETACHED_CASE),
    ],
  );
}

// 各テストの前に案件・通報・措置の記録・監査ログ・対象と管理者の表を空にし、3人の管理者とそのセッション、対象と4つの案件を用意する
export function installReportCaseGraphQLTest(): void {
  beforeEach(async () => {
    sentEmails.length = 0;
    emailFailure.error = undefined;
    purgeAfterFind.caseId = undefined;
    await clearReportCaseWrites();
    await clearModerationWrites();
    await clearEngagementTables();
    await clearAdminTables();
    await insertUser(OWNER);
    await insertUser(AUTHOR);
    await insertProduct(PRODUCT, OWNER);
    await insertLaunch(1, PRODUCT);
    await insertComment({
      index: COMMENT,
      product: PRODUCT,
      launch: 1,
      author: AUTHOR,
    });
    sessionTokens.clear();
    for (const [index, role] of ADMIN_ROLES) {
      await insertAdmin(index, { role });
      // セッションの検証は差し替えた時計で行われるため、発行も同じ時刻で行う
      const issued = await issueAdminSession(adminIdOf(index), {
        now: REPORT_CASE_TEST_NOW,
      });
      sessionTokens.set(index, issued.token);
    }
    await seedCases();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
}

export async function readProductHiddenAt(): Promise<Date | null | undefined> {
  const [row] = await db
    .select({ hiddenAt: products.hiddenAt })
    .from(products)
    .where(eq(products.id, productIdOf(PRODUCT)));
  return row?.hiddenAt;
}

export function callReportCaseOperation(
  document: string,
  variables: Record<string, unknown>,
  options: GatewayCallOptions,
): Promise<GatewayResponse> {
  return gateway.call(document, variables, options);
}

export interface ReportCaseFields {
  readonly id: string;
  readonly target: Record<string, unknown>;
  readonly status: string;
  readonly [field: string]: unknown;
}

export interface ReportCaseConnectionFields {
  readonly nodes: readonly ReportCaseFields[];
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly endCursor: string | null;
  };
}

export function fetchReportCases(
  variables: Record<string, unknown>,
  options: GatewayCallOptions = asViewer(),
) {
  return gateway.call<{
    adminReportCases: ReportCaseConnectionFields | null;
  }>(ADMIN_REPORT_CASES, variables, options);
}

export function fetchReportCase(
  id: string,
  options: GatewayCallOptions = asViewer(),
) {
  return gateway.call<{ adminReportCase: Record<string, unknown> | null }>(
    ADMIN_REPORT_CASE,
    { id },
    options,
  );
}

export function changeReportCaseStatus(variables: Record<string, unknown>) {
  return gateway.call<{
    changeReportCaseStatus: { status: string } | null;
  }>(CHANGE_STATUS, variables, asModerator());
}

export function closeReportCase(document: string, id: string, reason = REASON) {
  return gateway.call<Record<string, { status: string } | null>>(
    document,
    { id, reason },
    asModerator(),
  );
}

export function sendInfringementInquiry(variables: Record<string, unknown>) {
  return gateway.call<{
    sendInfringementInquiry: { sentAt: string; deadline: string } | null;
  }>(SEND_INQUIRY, variables, asModerator());
}
