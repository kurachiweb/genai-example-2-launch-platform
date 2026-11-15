import { ULTRAS_TYPES } from '../../core/ultras/identifiers.ts';
import type {
  PurchaseKindRegistration,
  SubscriptionEventSinkRegistration,
} from '../payments/fulfillment-contract.ts';
import { ULTRAS_PLAN_STATE_SINK_NAME } from './plan-state-sink.ts';

// 新規の加入の受け付けの可否は購入の可否の口が機能フラグで判定するため、登録には有効の条件を持たせず、フラグがオフでも既存の加入の有効化と状態の反映を続けられるようにする
export const ULTRAS_PURCHASE_KIND_REGISTRATION: PurchaseKindRegistration =
  Object.freeze({
    kind: 'ultras',
    offer: ULTRAS_TYPES.UltrasOfferPolicy,
    fulfillment: ULTRAS_TYPES.UltrasFulfillment,
  });

export const ULTRAS_SUBSCRIPTION_EVENT_SINK_REGISTRATION: SubscriptionEventSinkRegistration =
  Object.freeze({
    name: ULTRAS_PLAN_STATE_SINK_NAME,
    sink: ULTRAS_TYPES.PlanStateSink,
  });
