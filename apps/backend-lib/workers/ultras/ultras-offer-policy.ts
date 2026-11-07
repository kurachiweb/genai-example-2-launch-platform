import type { Logger } from '@logtape/logtape';

import { PAYMENTS_UNAVAILABLE_MESSAGE } from '../../../common-lib/payments/payments-unavailable-texts.ts';
import { PURCHASE_KIND_LABELS } from '../../../common-lib/payments/purchase-kinds.ts';
import { ultrasCheckoutNotesOf } from '../../../common-lib/ultras/checkout-notes.ts';
import {
  ULTRAS_PRICE_LOOKUP_KEY,
  type UltrasPlanStatus,
} from '../../../common-lib/ultras/plan-status.ts';
import { AppError } from '../../core/errors/app-error.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import type { PriceCatalog, StripePrice } from '../../core/payments/ports.ts';
import type {
  PurchaseOffer,
  PurchaseOfferDecision,
  PurchaseOfferPolicy,
  PurchaseOfferRequest,
} from '../../core/payments/purchase-kind-contract.ts';
import type {
  UltrasEntitlements,
  UltrasPromotionFlagReader,
} from '../../core/ultras/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';

export interface UltrasOfferPolicyDependencies {
  readonly appName: LoggingOptions['appName'];
  readonly flags: UltrasPromotionFlagReader;
  readonly entitlements: UltrasEntitlements;
  readonly prices: PriceCatalog;
}

export type UltrasOfferRejectionCode =
  | 'ultras_unavailable'
  | 'ultras_already_subscribed'
  | 'ultras_resume_in_portal';

export const ULTRAS_OFFER_REJECTION_MESSAGES: Readonly<
  Record<UltrasOfferRejectionCode, string>
> = Object.freeze({
  ultras_unavailable: '現在、Ultrasの新規の加入を受け付けていません。',
  ultras_already_subscribed: '既にUltrasに加入しています。',
  ultras_resume_in_portal:
    '解約済みのUltrasは課金期間の末日まで有効です。継続するには「解約・支払い方法の管理」から解約を取り消してください。',
});

// 特典の継続期間内の加入は重ねて始められない。解約済みはCustomer Portalで解約を取り消せるため案内を分ける
const REJECTION_BY_PLAN_STATUS: Readonly<
  Record<UltrasPlanStatus, UltrasOfferRejectionCode | null>
> = Object.freeze({
  active: 'ultras_already_subscribed',
  past_due: 'ultras_already_subscribed',
  canceled: 'ultras_resume_in_portal',
  ended: null,
});

const ULTRAS_QUANTITY_LABEL = '1か月(毎月自動更新)';
const ULTRAS_SERVICE_TIMING = '決済完了後ただちに';

function rejectionOf(code: UltrasOfferRejectionCode): PurchaseOfferDecision {
  return {
    kind: 'unavailable',
    code,
    message: ULTRAS_OFFER_REJECTION_MESSAGES[code],
  };
}

// 二重の加入は支払いの確定の反映で拒否するため、二重決済の鍵は持たない
function offerOf(price: StripePrice): PurchaseOffer {
  return Object.freeze({
    priceLookupKey: ULTRAS_PRICE_LOOKUP_KEY,
    quantity: 1,
    relatedId: null,
    exclusivityKey: null,
    deadlineAt: null,
    acceptUntil: null,
    fulfillableUntil: null,
    summary: Object.freeze({
      itemName: PURCHASE_KIND_LABELS.ultras,
      quantityLabel: ULTRAS_QUANTITY_LABEL,
      serviceTiming: ULTRAS_SERVICE_TIMING,
      additionalNotes: ultrasCheckoutNotesOf(price.unitAmount),
    }),
    requiresBotVerification: false,
  });
}

export class UltrasOfferPolicy implements PurchaseOfferPolicy {
  private readonly flags: UltrasPromotionFlagReader;
  private readonly entitlements: UltrasEntitlements;
  private readonly prices: PriceCatalog;
  private readonly logger: Logger;

  constructor(dependencies: UltrasOfferPolicyDependencies) {
    this.flags = dependencies.flags;
    this.entitlements = dependencies.entitlements;
    this.prices = dependencies.prices;
    this.logger = getAppLogger([dependencies.appName, 'application', 'ultras']);
  }

  // 利用者の状態(未確認・停止中)はCheckoutStarterが先に拒否する
  async describe(
    request: PurchaseOfferRequest,
  ): Promise<PurchaseOfferDecision> {
    if (!(await this.flags.isEnabled())) {
      return rejectionOf('ultras_unavailable');
    }
    const plan = await this.entitlements.currentPlan(
      request.userId,
      request.now,
    );
    const rejection =
      plan === null ? null : REJECTION_BY_PLAN_STATUS[plan.status];
    if (rejection !== null) {
      return rejectionOf(rejection);
    }
    return { kind: 'available', offer: offerOf(await this.monthlyPrice()) };
  }

  // 価格の照会はStripeに届かず保持した値も無いときだけ自ら投げ、Stripeに届いて月額の価格が無いときは空の結果を返すため、ここでも同じ失敗にそろえる
  private async monthlyPrice(): Promise<StripePrice> {
    const result = await this.prices.getPrices([ULTRAS_PRICE_LOOKUP_KEY]);
    const price = result.prices.find(
      ({ lookupKey }) => lookupKey === ULTRAS_PRICE_LOOKUP_KEY,
    );
    if (price !== undefined) {
      return price;
    }
    this.logger.warn(
      'Ultrasの月額の価格が照会の結果に無いため、決済を利用できないものとして扱いました',
      { priceLookup: ULTRAS_PRICE_LOOKUP_KEY, stale: result.stale },
    );
    throw new AppError({
      kind: 'unavailable',
      code: 'payments_unavailable',
      message: PAYMENTS_UNAVAILABLE_MESSAGE,
    });
  }
}
