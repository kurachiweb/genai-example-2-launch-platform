const SubscriptionStore: unique symbol = Symbol.for('ultras.SubscriptionStore');
const ActivationStore: unique symbol = Symbol.for('ultras.ActivationStore');
const NoticeStore: unique symbol = Symbol.for('ultras.NoticeStore');
const UltrasPromotionFlagReader: unique symbol = Symbol.for(
  'ultras.UltrasPromotionFlagReader',
);
const UltrasEntitlements: unique symbol = Symbol.for(
  'ultras.UltrasEntitlements',
);
const UltrasPlanExport: unique symbol = Symbol.for('ultras.UltrasPlanExport');
const ActivationDispatcher: unique symbol = Symbol.for(
  'ultras.ActivationDispatcher',
);
const UltrasNotifier: unique symbol = Symbol.for('ultras.UltrasNotifier');
const SubscriptionStatements: unique symbol = Symbol.for(
  'ultras.SubscriptionStatements',
);
const ActivationStatements: unique symbol = Symbol.for(
  'ultras.ActivationStatements',
);
const NoticeStatements: unique symbol = Symbol.for('ultras.NoticeStatements');
const UltrasOfferPolicy: unique symbol = Symbol.for('ultras.UltrasOfferPolicy');
const UltrasFulfillment: unique symbol = Symbol.for('ultras.UltrasFulfillment');
const PlanStateSink: unique symbol = Symbol.for('ultras.PlanStateSink');

// 識別子は型を読み込まないため、workersだけが受け取る契約(文を返す操作・paymentsの口の実装)の識別子も同じオブジェクトに置く
export const ULTRAS_TYPES = Object.freeze({
  SubscriptionStore,
  ActivationStore,
  NoticeStore,
  UltrasPromotionFlagReader,
  UltrasEntitlements,
  UltrasPlanExport,
  ActivationDispatcher,
  UltrasNotifier,
  SubscriptionStatements,
  ActivationStatements,
  NoticeStatements,
  UltrasOfferPolicy,
  UltrasFulfillment,
  PlanStateSink,
});
