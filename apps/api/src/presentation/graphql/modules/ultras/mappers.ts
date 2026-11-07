import type { UltrasPlanStatus } from '../../../../../common-lib/ultras/plan-status.ts';
import type { UltrasPlanView } from '../../../../../lib/core/ultras/ports.ts';
import type {
  UltrasOfferView,
  ViewerUltrasView,
} from '../../../../application/ultras/ultras-plan-reader.ts';
import type {
  UltrasOffer,
  UltrasPlan,
  UltrasPlanStatus as UltrasPlanStatusValue,
  ViewerUltras,
} from '../../generated/resolvers-types.ts';

const ULTRAS_PLAN_STATUS_VALUES: Readonly<
  Record<UltrasPlanStatus, UltrasPlanStatusValue>
> = Object.freeze({
  active: 'ACTIVE',
  past_due: 'PAST_DUE',
  canceled: 'CANCELED',
  ended: 'ENDED',
});

export function toUltrasOffer(view: UltrasOfferView): UltrasOffer {
  return {
    promotionEnabled: view.promotionEnabled,
    price: view.price === null ? null : { ...view.price },
    priceStale: view.priceStale,
  };
}

function toUltrasPlan(plan: UltrasPlanView): UltrasPlan {
  return {
    status: ULTRAS_PLAN_STATUS_VALUES[plan.status],
    startedAt: plan.startedAt,
    currentPeriodEndsAt: plan.currentPeriodEndsAt,
    benefitEndsAt: plan.benefitEndsAt,
    canceledAt: plan.canceledAt,
  };
}

export function toViewerUltras(view: ViewerUltrasView): ViewerUltras {
  return {
    plan: view.plan === null ? null : toUltrasPlan(view.plan),
    entitled: view.entitled,
    canOpenPortal: view.canOpenPortal,
  };
}
