import { inject, injectable } from 'inversify';

import {
  computePeriodWindows,
  type SponsorshipDateWindow,
} from '../../../common-lib/sponsorship/sponsorship-period.ts';
import {
  SPONSORSHIP_PRICE_LOOKUP_KEYS,
  SPONSORSHIP_TIERS,
  type SponsorshipTier,
} from '../../../common-lib/sponsorship/sponsorship-tiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type {
  AccountGuard,
  CurrentUser,
} from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import type {
  PriceCatalog,
  PriceCatalogResult,
} from '../../../lib/core/payments/ports.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import { SPONSORSHIP_PLATFORM_TYPES } from '../../../lib/core/sponsorship/identifiers.ts';
import type {
  EligibleProduct,
  EligibleProductReader,
  SponsorshipStore,
} from '../../../lib/core/sponsorship/ports.ts';
import {
  type BusinessDate,
  parseBusinessDate,
  toBusinessDateTime,
} from '../../../lib/core/time/business-time.ts';
import type { CheckoutMoney } from '../payments/checkout-view.ts';
import {
  sponsorshipError,
  sponsorshipPeriodValidationError,
} from './sponsorship-errors.ts';
import { nextDayStartsAtOf } from './sponsorship-view.ts';

export interface SponsorshipTierOfferView {
  readonly tier: SponsorshipTier;
  // 取得できなければnull
  readonly unitPrice: CheckoutMoney | null;
}

export interface SponsorshipOfferView {
  readonly tiers: readonly SponsorshipTierOfferView[];
  // 未ログインはnull
  readonly eligibleProducts: readonly EligibleProduct[] | null;
}

export interface SponsorshipPeriodWindowView {
  readonly businessToday: BusinessDate;
  // 次の基準時刻の0:00。画面はこの時点で取り直す
  readonly nextDayStartsAt: Date;
  readonly start: SponsorshipDateWindow;
  // startsOnを渡さない、またはstartsOnが開始日の範囲で選べない日ならnull
  readonly end: SponsorshipDateWindow | null;
}

export interface SponsorshipOfferReader {
  // ログイン不要
  read(input: {
    readonly viewer: CurrentUser | undefined;
    readonly now: Date;
  }): Promise<SponsorshipOfferView>;
  // 停止中・未確認の利用者にも答える。申込の対象でないプロダクトはsponsorship_product_ineligible
  readPeriodWindow(input: {
    readonly session: SessionView;
    readonly productId: string;
    readonly tier: SponsorshipTier;
    readonly startsOn: string | null;
    readonly now: Date;
  }): Promise<SponsorshipPeriodWindowView>;
}

const logger = getAppLogger(['api', 'application', 'sponsorship']);

const LOOKUP_KEYS: readonly string[] = SPONSORSHIP_TIERS.map(
  (tier) => SPONSORSHIP_PRICE_LOOKUP_KEYS[tier],
);

const NO_PRICES: readonly SponsorshipTierOfferView[] = Object.freeze(
  SPONSORSHIP_TIERS.map((tier) => ({ tier, unitPrice: null })),
);

const isPaymentsUnavailable = (error: unknown): boolean =>
  error instanceof AppError && error.code === 'payments_unavailable';

const parseStartsOn = (startsOn: string): BusinessDate => {
  try {
    return parseBusinessDate(startsOn);
  } catch (error: unknown) {
    if (error instanceof RangeError) {
      throw sponsorshipPeriodValidationError({ startsOn: 'invalid' });
    }
    throw error;
  }
};

@injectable()
export class DefaultSponsorshipOfferReader implements SponsorshipOfferReader {
  constructor(
    @inject(IDENTITY_PLATFORM_TYPES.AccountGuard)
    private readonly guard: AccountGuard,
    @inject(PAYMENTS_TYPES.PriceCatalog)
    private readonly prices: PriceCatalog,
    @inject(SPONSORSHIP_PLATFORM_TYPES.EligibleProductReader)
    private readonly eligibleProducts: EligibleProductReader,
    @inject(SPONSORSHIP_PLATFORM_TYPES.SponsorshipStore)
    private readonly store: SponsorshipStore,
  ) {}

  async read({
    viewer,
    now,
  }: Parameters<
    SponsorshipOfferReader['read']
  >[0]): Promise<SponsorshipOfferView> {
    const [tiers, eligibleProducts] = await Promise.all([
      this.tierPrices(),
      viewer === undefined
        ? Promise.resolve(null)
        : this.eligibleProducts.list(viewer.user.id, now),
    ]);
    return { tiers, eligibleProducts };
  }

  async readPeriodWindow({
    session,
    productId,
    tier,
    startsOn,
    now,
  }: Parameters<
    SponsorshipOfferReader['readPeriodWindow']
  >[0]): Promise<SponsorshipPeriodWindowView> {
    const { user } = await this.guard.requireUser(session);
    // 他人や対象外のプロダクトの決済済みの掲載期間を返さないため、範囲を求める前に確かめる
    if (!(await this.eligibleProducts.isEligible(user.id, productId, now))) {
      throw sponsorshipError('sponsorship_product_ineligible');
    }
    const selectedStart = startsOn === null ? null : parseStartsOn(startsOn);
    const today = toBusinessDateTime(now).date;
    const paidPeriods = await this.store.listPaidPeriods({
      productId,
      tier,
      endsOnOrAfter: today,
    });
    const windows = computePeriodWindows({
      today,
      startsOn: selectedStart,
      paidPeriods,
    });
    return {
      businessToday: today,
      nextDayStartsAt: nextDayStartsAtOf(today),
      start: windows.start,
      end: windows.end,
    };
  }

  // 料金ページは価格を表示できなくても説明と申込の対象を出すため、Stripeに到達できず保持した値も無い失敗だけは単価を空にして返す
  private async tierPrices(): Promise<readonly SponsorshipTierOfferView[]> {
    let result: PriceCatalogResult;
    try {
      result = await this.prices.getPrices(LOOKUP_KEYS);
    } catch (error: unknown) {
      if (isPaymentsUnavailable(error)) {
        return NO_PRICES;
      }
      throw error;
    }
    const tiers = SPONSORSHIP_TIERS.map((tier) => {
      const price = result.prices.find(
        ({ lookupKey }) => lookupKey === SPONSORSHIP_PRICE_LOOKUP_KEYS[tier],
      );
      return {
        tier,
        unitPrice:
          price === undefined
            ? null
            : { amount: price.unitAmount, currency: price.currency },
      };
    });
    const missing = tiers
      .filter(({ unitPrice }) => unitPrice === null)
      .map(({ tier }) => SPONSORSHIP_PRICE_LOOKUP_KEYS[tier]);
    if (missing.length > 0) {
      logger.warn(
        'スポンサー広告の価格が照会の結果に無いため、そのティアの単価を表示できないものとして返しました',
        { priceLookups: missing, stale: result.stale },
      );
    }
    return tiers;
  }
}
