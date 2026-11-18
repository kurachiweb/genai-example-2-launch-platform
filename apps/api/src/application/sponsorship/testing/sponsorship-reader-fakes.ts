import { AppError } from '../../../../lib/core/errors/app-error.ts';
import type { AccountGuard } from '../../../../lib/core/identity/account-guard.ts';
import type {
  PriceCatalog,
  PriceCatalogResult,
  StripePrice,
} from '../../../../lib/core/payments/ports.ts';
import type {
  ProductDirectory,
  ProductHandleResolution,
  ProductLookupScope,
  ProductSummaryRecord,
} from '../../../../lib/core/product/ports.ts';
import type {
  EligibleProduct,
  EligibleProductReader,
  SponsorshipDatePeriodRecord,
  SponsorshipPage,
  SponsorshipPageInput,
  SponsorshipStore,
} from '../../../../lib/core/sponsorship/ports.ts';
import type { BusinessDate } from '../../../../lib/core/time/business-time.ts';
import {
  CURRENT_USER,
  PRODUCT_ID,
  USER_ID,
} from './sponsorship-application-fakes.ts';

export function productSummaryOf(
  overrides: Partial<ProductSummaryRecord> = {},
): ProductSummaryRecord {
  return {
    productId: PRODUCT_ID,
    ownerUserId: USER_ID,
    handle: 'sponsored-product',
    name: '広告のプロダクト',
    tagline: '広告のプロダクトの説明',
    category: {
      id: '01JF0SPCATG000000000000001',
      name: '開発ツール',
      handle: 'developer-tools',
    },
    websiteUrl: 'https://product.example',
    logoFileId: '01JF0SPLOGO000000000000001',
    hidden: false,
    visible: true,
    listed: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

export function stripePriceOf(
  lookupKey: string,
  unitAmount: number,
): StripePrice {
  return {
    lookupKey,
    priceId: `price_${lookupKey}`,
    unitAmount,
    currency: 'usd',
    recurringInterval: null,
  };
}

export const ELIGIBLE_PRODUCT: EligibleProduct = Object.freeze({
  productId: PRODUCT_ID,
  handle: 'sponsored-product',
  name: '広告のプロダクト',
  logoFileId: '01JF0SPLOGO000000000000001',
});

export const paymentsUnavailableError = (): AppError =>
  new AppError({
    kind: 'unavailable',
    code: 'payments_unavailable',
    message: '現在、決済を利用できません。',
  });

export const unauthenticatedError = (): AppError =>
  new AppError({
    kind: 'unauthenticated',
    code: 'unauthenticated',
    message: 'ログインしてください。',
  });

export type ReaderCall =
  | { readonly kind: 'requireUser' }
  | { readonly kind: 'getPrices'; readonly lookupKeys: readonly string[] }
  | { readonly kind: 'list'; readonly userId: string; readonly now: Date }
  | {
      readonly kind: 'isEligible';
      readonly userId: string;
      readonly productId: string;
      readonly now: Date;
    }
  | {
      readonly kind: 'listPaidPeriods';
      readonly input: Parameters<SponsorshipStore['listPaidPeriods']>[0];
    }
  | {
      readonly kind: 'listByOwner';
      readonly userId: string;
      readonly page: SponsorshipPageInput;
    }
  | {
      readonly kind: 'countActiveForProduct';
      readonly productId: string;
      readonly today: BusinessDate;
    }
  | {
      readonly kind: 'findSummaries';
      readonly productIds: readonly string[];
      readonly scope: ProductLookupScope;
    }
  | { readonly kind: 'resolveHandle'; readonly handle: string };

export interface ReaderFakeOptions {
  readonly guardError?: AppError;
  readonly prices?: PriceCatalogResult;
  readonly pricesError?: Error;
  readonly eligibleProducts?: readonly EligibleProduct[];
  readonly eligible?: boolean;
  readonly paidPeriods?: readonly SponsorshipDatePeriodRecord[];
  readonly page?: SponsorshipPage;
  readonly activeCount?: number;
  readonly summaries?: readonly ProductSummaryRecord[];
  readonly resolution?: ProductHandleResolution;
}

export interface ReaderFakes {
  readonly calls: ReaderCall[];
  readonly guard: AccountGuard;
  readonly prices: PriceCatalog;
  readonly eligibleProducts: EligibleProductReader;
  readonly store: SponsorshipStore;
  readonly products: ProductDirectory;
}

const unexpected = (): Promise<never> =>
  Promise.reject(new Error('呼ばれない想定です'));

const EMPTY_PAGE: SponsorshipPage = Object.freeze({
  records: [],
  hasNextPage: false,
  endCursor: null,
});

export function createReaderFakes(
  options: ReaderFakeOptions = {},
): ReaderFakes {
  const calls: ReaderCall[] = [];
  const guard: AccountGuard = {
    currentUser: unexpected,
    requireUser: () => {
      calls.push({ kind: 'requireUser' });
      return options.guardError === undefined
        ? Promise.resolve(CURRENT_USER)
        : Promise.reject(options.guardError);
    },
    requireWritableUser: unexpected,
    requireVerifiedUser: unexpected,
  };
  const prices: PriceCatalog = {
    getPrices: (lookupKeys) => {
      calls.push({ kind: 'getPrices', lookupKeys });
      return options.pricesError === undefined
        ? Promise.resolve(options.prices ?? { prices: [], stale: false })
        : Promise.reject(options.pricesError);
    },
  };
  const eligibleProducts: EligibleProductReader = {
    list: (userId, now) => {
      calls.push({ kind: 'list', userId, now });
      return Promise.resolve(options.eligibleProducts ?? [ELIGIBLE_PRODUCT]);
    },
    isEligible: (userId, productId, now) => {
      calls.push({ kind: 'isEligible', userId, productId, now });
      return Promise.resolve(options.eligible ?? true);
    },
  };
  const store: SponsorshipStore = {
    create: unexpected,
    findById: unexpected,
    hasPaidOverlap: unexpected,
    listPaidPeriods: (input) => {
      calls.push({ kind: 'listPaidPeriods', input });
      return Promise.resolve(options.paidPeriods ?? []);
    },
    listByOwner: (userId, page) => {
      calls.push({ kind: 'listByOwner', userId, page });
      return Promise.resolve(options.page ?? EMPTY_PAGE);
    },
    listForAdmin: unexpected,
    countActiveForProduct: (productId, today) => {
      calls.push({ kind: 'countActiveForProduct', productId, today });
      return Promise.resolve(options.activeCount ?? 0);
    },
    deleteUnpaid: unexpected,
    deleteExpiredUnpaid: unexpected,
    listUnsettledEnded: unexpected,
  };
  const products: ProductDirectory = {
    findSummaries: (productIds, scope) => {
      calls.push({ kind: 'findSummaries', productIds, scope });
      return Promise.resolve(
        new Map(
          (options.summaries ?? [])
            .filter(({ productId }) => productIds.includes(productId))
            .map((summary) => [summary.productId, summary]),
        ),
      );
    },
    resolveHandle: (handle) => {
      calls.push({ kind: 'resolveHandle', handle });
      return Promise.resolve(options.resolution ?? { kind: 'none' });
    },
    findDetail: unexpected,
    listLaunches: unexpected,
  };
  return { calls, guard, prices, eligibleProducts, store, products };
}
