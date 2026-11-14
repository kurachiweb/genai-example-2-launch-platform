import { inject, injectable } from 'inversify';

import { ULTRAS_PRICE_LOOKUP_KEY } from '../../../common-lib/ultras/plan-status.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { AccountGuard } from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import type {
  PriceCatalog,
  PriceCatalogResult,
} from '../../../lib/core/payments/ports.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { ULTRAS_TYPES } from '../../../lib/core/ultras/identifiers.ts';
import type {
  UltrasEntitlements,
  UltrasPlanView,
  UltrasPromotionFlagReader,
} from '../../../lib/core/ultras/ports.ts';
import type { CheckoutMoney } from '../payments/checkout-view.ts';

export interface UltrasOfferView {
  readonly promotionEnabled: boolean;
  // 照会できなければnull
  readonly price: CheckoutMoney | null;
  // Stripeに到達できず、以前に照会した価格を返したときに真
  readonly priceStale: boolean;
}

export interface ViewerUltrasView {
  // 最新の有効化された加入。加入したことが無ければnull
  readonly plan: UltrasPlanView | null;
  readonly entitled: boolean;
  readonly canOpenPortal: boolean;
}

export interface UltrasPlanReader {
  // ログイン不要
  offer(): Promise<UltrasOfferView>;
  // 未ログインはnull
  viewer(session: SessionView): Promise<ViewerUltrasView | null>;
}

type OfferPrice = Pick<UltrasOfferView, 'price' | 'priceStale'>;

const logger = getAppLogger(['api', 'application', 'ultras']);

const NO_PRICE: OfferPrice = Object.freeze({ price: null, priceStale: false });

const isPaymentsUnavailable = (error: unknown): boolean =>
  error instanceof AppError && error.code === 'payments_unavailable';

@injectable()
export class DefaultUltrasPlanReader implements UltrasPlanReader {
  constructor(
    @inject(ULTRAS_TYPES.UltrasPromotionFlagReader)
    private readonly flags: UltrasPromotionFlagReader,
    @inject(ULTRAS_TYPES.UltrasEntitlements)
    private readonly entitlements: UltrasEntitlements,
    @inject(PAYMENTS_TYPES.PriceCatalog)
    private readonly prices: PriceCatalog,
    @inject(IDENTITY_PLATFORM_TYPES.AccountGuard)
    private readonly guard: AccountGuard,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async offer(): Promise<UltrasOfferView> {
    const promotionEnabled = await this.flags.isEnabled();
    return { promotionEnabled, ...(await this.monthlyPrice()) };
  }

  async viewer(session: SessionView): Promise<ViewerUltrasView | null> {
    const current = await this.guard.currentUser(session);
    if (current === undefined) {
      return null;
    }
    const now = this.clock.now();
    const plan = await this.entitlements.currentPlan(current.user.id, now);
    const entitled = await this.entitlements.isEntitledAt(current.user.id, now);
    return { plan, entitled, canOpenPortal: plan !== null };
  }

  // 料金ページは価格を表示できなくても特典と案内を出すため、Stripeに到達できず保持した値も無い失敗だけは価格を空にして返す
  private async monthlyPrice(): Promise<OfferPrice> {
    let result: PriceCatalogResult;
    try {
      result = await this.prices.getPrices([ULTRAS_PRICE_LOOKUP_KEY]);
    } catch (error: unknown) {
      if (isPaymentsUnavailable(error)) {
        return NO_PRICE;
      }
      throw error;
    }
    const price = result.prices.find(
      ({ lookupKey }) => lookupKey === ULTRAS_PRICE_LOOKUP_KEY,
    );
    if (price === undefined) {
      logger.warn(
        'Ultrasの月額の価格が照会の結果に無いため、価格を表示できないものとして返しました',
        { priceLookup: ULTRAS_PRICE_LOOKUP_KEY, stale: result.stale },
      );
      return NO_PRICE;
    }
    return {
      price: { amount: price.unitAmount, currency: price.currency },
      priceStale: result.stale,
    };
  }
}
