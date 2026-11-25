import { AppError } from '../../../../lib/core/errors/app-error.ts';
import type { CurrentUser } from '../../../../lib/core/identity/account-guard.ts';
import type { MatchRecord } from '../../../../lib/core/match/ports.ts';
import type {
  PriceCatalog,
  PriceCatalogResult,
  StripePrice,
} from '../../../../lib/core/payments/ports.ts';
import type {
  LaunchRecord,
  ProductDirectory,
  ProductHandleResolution,
} from '../../../../lib/core/product/ports.ts';
import { parseBusinessDate } from '../../../../lib/core/time/business-time.ts';
import type { BracketParticipantStanding } from '../../../../lib/core/tournament/ports.ts';
import type { UltrasEntitlements } from '../../../../lib/core/ultras/ports.ts';
import type {
  YearEntryRecord,
  YearTournamentRecord,
} from '../../../../lib/core/year-tournament/ports.ts';
import { YEAR_ENTRY_PRICE_LOOKUP_KEY } from '../../../../lib/core/year-tournament/year-schedule.ts';
import {
  launchRecordOf,
  productSummaryOf,
} from '../../match/testing/kickoff-fakes.ts';
import { DirectoryYearEntryPanelReader } from '../year-entry-panel-reader.ts';
import {
  AWARDED_AT,
  launchIdOf,
  productIdOf,
  STORED_SCHEDULE,
  yearRowOf,
} from './year-decision-fakes.ts';
import { createYearSummaryFakes } from './year-summary-fakes.ts';

export const OWNER_USER_ID = '01JF0YACCT0000000000000001';
export const OTHER_USER_ID = '01JF0YACCT0000000000000002';
export const HANDLE = 'year-entry-product';

// 2027年の受付期限(2027-06-07 23:00)より前
export const NOW = new Date('2027-03-05T12:00:00.000Z');
export const AFTER_ACCEPT_UNTIL = new Date(
  STORED_SCHEDULE.acceptUntil.getTime() + 1,
);
export const AFTER_DEADLINE = new Date(
  STORED_SCHEDULE.deadlineAt.getTime() + 60_000,
);

export const VIEWER: CurrentUser = {
  principal: {
    kind: 'authenticated',
    subjectKind: 'user',
    subjectId: OWNER_USER_ID,
    sessionId: '01JF0YSESS0000000000000001',
  },
  user: {
    id: OWNER_USER_ID,
    pseudonymousId: '01JF0YPSEU0000000000000001',
    status: 'active',
    emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    email: 'owner@mail.example',
    nickname: '投稿者',
    handle: 'owner',
  },
};

export const ENTRY_PRICE: StripePrice = Object.freeze({
  lookupKey: YEAR_ENTRY_PRICE_LOOKUP_KEY,
  priceId: 'price_year_entry',
  unitAmount: 2000,
  currency: 'usd',
  recurringInterval: null,
});

export const PAYMENTS_UNAVAILABLE = new AppError({
  kind: 'unavailable',
  code: 'payments_unavailable',
  message: '現在、決済をご利用いただけません。',
});

export const PRODUCT = productSummaryOf(productIdOf(1), {
  ownerUserId: OWNER_USER_ID,
  handle: HANDLE,
});

export const WON_LAUNCH = launchRecordOf(launchIdOf(1), productIdOf(1), {
  launchDate: parseBusinessDate('2026-09-09'),
  status: 'finished',
  outcome: 'won',
  decidedAt: AWARDED_AT,
});

export const OPEN_YEAR_ROW = yearRowOf();

export interface PanelScenario {
  readonly resolution?: ProductHandleResolution;
  readonly launches?: readonly LaunchRecord[];
  readonly entries?: readonly YearEntryRecord[];
  readonly years?: readonly YearTournamentRecord[];
  readonly standings?: ReadonlyMap<string, BracketParticipantStanding>;
  readonly matches?: ReadonlyMap<string, readonly MatchRecord[]>;
  readonly entitledDuring?: boolean;
  readonly prices?: PriceCatalogResult | Error;
}

const unused = (name: string) => (): never => {
  throw new Error(`照会は${name}を呼ばない`);
};

// 参加費の導線の照会が読む部品を偽物にし、渡された値を記録する
export function createPanelFakes(scenario: PanelScenario = {}) {
  const summary = createYearSummaryFakes({
    entries: scenario.entries ?? [],
    years: scenario.years ?? [OPEN_YEAR_ROW],
    standings: scenario.standings,
    matches: scenario.matches,
  });
  const reads = {
    ...summary.reads,
    handleReads: [] as string[],
    launchReads: [] as { productIds: readonly string[]; now: Date }[],
    entitlementReads: [] as { userId: string; from: Date; to: Date }[],
    priceReads: [] as (readonly string[])[],
  };
  const products: ProductDirectory = {
    resolveHandle(handle) {
      reads.handleReads.push(handle);
      return Promise.resolve(
        scenario.resolution ?? { kind: 'current', product: PRODUCT },
      );
    },
    listLaunches(productIds, now) {
      reads.launchReads.push({ productIds, now });
      return Promise.resolve(
        new Map([[PRODUCT.productId, scenario.launches ?? [WON_LAUNCH]]]),
      );
    },
    findSummaries: unused('findSummaries'),
    findDetail: unused('findDetail'),
  };
  const entitlements: UltrasEntitlements = {
    wasEntitledDuring(userId, from, to) {
      reads.entitlementReads.push({ userId, from, to });
      return Promise.resolve(scenario.entitledDuring ?? false);
    },
    isEntitledAt: unused('isEntitledAt'),
    entitledUsersAt: unused('entitledUsersAt'),
    entitledUsersDuring: unused('entitledUsersDuring'),
    currentPlan: unused('currentPlan'),
  };
  const prices: PriceCatalog = {
    getPrices(lookupKeys) {
      reads.priceReads.push(lookupKeys);
      const result = scenario.prices ?? { prices: [ENTRY_PRICE], stale: false };
      return result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve(result);
    },
  };
  const reader = new DirectoryYearEntryPanelReader(
    products,
    summary.entries,
    summary.calendar,
    summary.brackets,
    summary.matches,
    entitlements,
    prices,
  );
  return { reader, reads };
}

export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('拒否される想定です');
}
