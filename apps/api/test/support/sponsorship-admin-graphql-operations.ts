import { asc, eq } from 'drizzle-orm';
import { ContainerModule } from 'inversify';
import { afterEach, beforeEach, vi } from 'vitest';

import type { AdminRole } from '../../common-lib/admin/admin-roles.ts';
import { adminAuditLogs } from '../../db/schema/admin/admin-audit-logs.ts';
import { paymentRefunds } from '../../db/schema/payments/payment-refunds.ts';
import { sponsorships } from '../../db/schema/sponsorship/sponsorships.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import { PAYMENTS_TYPES } from '../../lib/core/payments/identifiers.ts';
import type { RefundRejectionCode } from '../../lib/core/payments/refund-rejection.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import type { PaymentRefundStatements } from '../../lib/workers/payments/statement-contracts.ts';
import {
  clearSponsorshipTables,
  sponsorshipIdOf,
} from '../../lib/workers/sponsorship/testing/sponsorship-fixtures.ts';
import {
  adminIdOf,
  clearAdminTables,
  db,
  insertAdmin,
} from '../../src/infrastructure/admin/testing/admin-store-fixtures.ts';
import { mediaSchemaModule } from '../../src/presentation/graphql/modules/media/index.ts';
import { paymentsSchemaModule } from '../../src/presentation/graphql/modules/payments/index.ts';
import { sponsorshipSchemaModule } from '../../src/presentation/graphql/modules/sponsorship/index.ts';
import { issueAdminSession } from './admin-graphql-harness.ts';
import {
  createGraphQLGateway,
  type GatewayApp,
  type GatewayCallOptions,
} from './graphql-gateway.ts';
import {
  type MoneyFields,
  SPONSORSHIP_TEST_NOW,
  type TierValue,
} from './sponsorship-graphql-operations.ts';

export { codesOf, detailsOf } from './payments-graphql-operations.ts';

export type SponsorshipStatusValue =
  | 'PENDING_PAYMENT'
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'PAUSED'
  | 'ENDED'
  | 'TERMINATED';

export type AdminStatusFilterValue = Exclude<SponsorshipStatusValue, 'PAUSED'>;

export type RefundStatusValue = 'REQUESTED' | 'ALREADY_REFUNDED' | 'REJECTED';

export interface AdminSponsorshipFields {
  readonly id: string;
  readonly productName: string | null;
  readonly productHandle: string | null;
  readonly productDeleted: boolean;
  readonly applicantNickname: string | null;
  readonly tier: TierValue;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly days: number;
  readonly amountPaid: MoneyFields | null;
  readonly status: SponsorshipStatusValue;
  readonly terminable: boolean;
  readonly purchaseId: string | null;
  readonly createdAt: string;
}

export interface AdminSponsorshipsFields {
  readonly nodes: readonly AdminSponsorshipFields[];
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly endCursor: string | null;
  };
}

export interface AdminSponsorshipFilterInput {
  readonly status?: AdminStatusFilterValue | null;
  readonly tier?: TierValue | null;
}

export interface TerminationPreviewFields {
  readonly id: string;
  readonly days: number;
  readonly amountPaid: MoneyFields;
  readonly unexposedDays: number;
  readonly refundEstimate: MoneyFields;
  readonly stoppedDays: number;
  readonly stopRefundAmount: MoneyFields;
}

export interface TerminationResultFields extends TerminationPreviewFields {
  readonly terminatedOn: string;
  readonly terminationRefundStatus: RefundStatusValue | null;
  readonly stopRefundStatus: RefundStatusValue | null;
  readonly terminationRefundRequested: MoneyFields | null;
  readonly stopRefundRequested: MoneyFields | null;
  readonly purchaseId: string;
}

const MONEY_SELECTION = /* GraphQL */ `
  amount
  currency
`;

const PREVIEW_SELECTION = /* GraphQL */ `
  id
  days
  amountPaid { ${MONEY_SELECTION} }
  unexposedDays
  refundEstimate { ${MONEY_SELECTION} }
  stoppedDays
  stopRefundAmount { ${MONEY_SELECTION} }
`;

export const ADMIN_SPONSORSHIPS = /* GraphQL */ `
  query AdminSponsorships(
    $filter: AdminSponsorshipFilter
    $first: Int!
    $after: String
  ) {
    adminSponsorships(filter: $filter, first: $first, after: $after) {
      nodes {
        id
        productName
        productHandle
        productDeleted
        applicantNickname
        tier
        startsOn
        endsOn
        days
        amountPaid { ${MONEY_SELECTION} }
        status
        terminable
        purchaseId
        createdAt
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const SPONSORSHIP_TERMINATION_PREVIEW = /* GraphQL */ `
  query AdminSponsorshipTerminationPreview($id: ID!) {
    sponsorshipTerminationPreview(id: $id) {
      ${PREVIEW_SELECTION}
    }
  }
`;

export const TERMINATE_SPONSORSHIP = /* GraphQL */ `
  mutation AdminTerminateSponsorship($id: ID!, $reason: String!) {
    terminateSponsorship(id: $id, reason: $reason) {
      ${PREVIEW_SELECTION}
      terminatedOn
      terminationRefundStatus
      stopRefundStatus
      terminationRefundRequested { ${MONEY_SELECTION} }
      stopRefundRequested { ${MONEY_SELECTION} }
      purchaseId
    }
  }
`;

const testClock: Clock = { now: () => SPONSORSHIP_TEST_NOW };

let refundRejection: RefundRejectionCode | null = null;

// 決済の機能が依頼を拒否する結果(形式の誤りなど)は実際の入力で起こせないため、指定したときだけ準備の段階で拒否を返す
function rejectingRefundStatements(
  inner: PaymentRefundStatements,
): PaymentRefundStatements {
  return {
    prepare: (input) => {
      const code = refundRejection;
      return code === null
        ? inner.prepare(input)
        : Promise.resolve({ kind: 'rejected', code });
    },
    prepareForReflection: (input) => inner.prepareForReflection(input),
  };
}

const overridesModule: AppModule<GatewayApp> = {
  name: 'sponsorship-admin-graphql-test-overrides',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(testClock);
    rebind<PaymentRefundStatements>(
      PAYMENTS_TYPES.PaymentRefundStatements,
    ).toDynamicValue((context) =>
      rejectingRefundStatements(
        context.get<PaymentRefundStatements>(PAYMENTS_TYPES.PaymentRefunds),
      ),
    );
  }),
};

// スポンサー広告の型定義はpaymentsのMoney・CheckoutStartとメディアのMediaImageを参照するため、それらのスキーマモジュールと合わせて載せる
const adminGateway = createGraphQLGateway({
  documents: [
    ADMIN_SPONSORSHIPS,
    SPONSORSHIP_TERMINATION_PREVIEW,
    TERMINATE_SPONSORSHIP,
  ],
  schemaModules: [
    mediaSchemaModule,
    paymentsSchemaModule,
    sponsorshipSchemaModule,
  ],
  overrides: [overridesModule],
});

export const SPONSORSHIP_ADMINS = Object.freeze({
  superAdmin: 1,
  moderator: 2,
  viewer: 3,
});

const ADMIN_ROLES: readonly (readonly [number, AdminRole])[] = [
  [SPONSORSHIP_ADMINS.superAdmin, 'super_admin'],
  [SPONSORSHIP_ADMINS.moderator, 'moderator'],
  [SPONSORSHIP_ADMINS.viewer, 'viewer'],
];

const adminSessionTokens = new Map<number, string>();

export function asSponsorshipAdmin(adminIndex: number): GatewayCallOptions {
  const sessionToken = adminSessionTokens.get(adminIndex);
  if (sessionToken === undefined) {
    throw new Error(`管理者${String(adminIndex)}のセッションがありません`);
  }
  return { caller: 'admin', sessionToken };
}

export function rejectSponsorshipRefunds(code: RefundRejectionCode): void {
  refundRejection = code;
}

// 各テストの前に申込・決済・プロダクト・利用者と監査ログを含む管理者の表を空にし、3人の管理者とそのセッションを用意する
export function installSponsorshipAdminGraphQLTest(): void {
  beforeEach(async () => {
    refundRejection = null;
    await clearSponsorshipTables();
    await clearAdminTables();
    adminSessionTokens.clear();
    for (const [index, role] of ADMIN_ROLES) {
      await insertAdmin(index, { role });
      // セッションの検証は差し替えた時計で行われるため、発行も同じ時刻で行う
      const issued = await issueAdminSession(adminIdOf(index), {
        now: SPONSORSHIP_TEST_NOW,
      });
      adminSessionTokens.set(index, issued.token);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
}

export function fetchAdminSponsorships(
  variables: {
    readonly filter?: AdminSponsorshipFilterInput | null;
    readonly first: number;
    readonly after?: string | null;
  },
  options?: GatewayCallOptions,
) {
  return adminGateway.call<{
    adminSponsorships: AdminSponsorshipsFields | null;
  }>(ADMIN_SPONSORSHIPS, variables, options);
}

export function fetchTerminationPreview(
  id: string,
  options?: GatewayCallOptions,
) {
  return adminGateway.call<{
    sponsorshipTerminationPreview: TerminationPreviewFields | null;
  }>(SPONSORSHIP_TERMINATION_PREVIEW, { id }, options);
}

export function terminateSponsorship(
  variables: { readonly id: string; readonly reason: string },
  options?: GatewayCallOptions,
) {
  return adminGateway.call<{
    terminateSponsorship: TerminationResultFields | null;
  }>(TERMINATE_SPONSORSHIP, variables, options);
}

export async function readTerminationColumns(index: number) {
  const [row] = await db
    .select({
      state: sponsorships.state,
      terminatedAt: sponsorships.terminatedAt,
      terminationReason: sponsorships.terminationReason,
      terminationRefundStatus: sponsorships.terminationRefundStatus,
      stopRefundStatus: sponsorships.stopRefundStatus,
    })
    .from(sponsorships)
    .where(eq(sponsorships.id, sponsorshipIdOf(index)));
  return row;
}

export async function readRefundRequests() {
  return db
    .select({
      requestKey: paymentRefunds.requestKey,
      amount: paymentRefunds.amount,
      reason: paymentRefunds.reason,
    })
    .from(paymentRefunds)
    .orderBy(asc(paymentRefunds.requestKey));
}

export async function readAuditLogs() {
  return db
    .select({
      operatorAdminId: adminAuditLogs.operatorAdminId,
      action: adminAuditLogs.action,
      reason: adminAuditLogs.reason,
      detail: adminAuditLogs.detail,
    })
    .from(adminAuditLogs)
    .orderBy(asc(adminAuditLogs.id));
}
