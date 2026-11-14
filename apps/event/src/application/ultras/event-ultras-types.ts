// backend-lib/core/ultrasのULTRAS_TYPESとAPIサーバーのAPI_ULTRAS_TYPESも同じultras.の接頭辞を使うため、メンバーの名前を重ねない
const RunActivationHandlersHandler: unique symbol = Symbol.for(
  'ultras.RunActivationHandlersHandler',
);

const SubscriptionCancellationHandler: unique symbol = Symbol.for(
  'ultras.SubscriptionCancellationHandler',
);

const SubscriptionErasureHandler: unique symbol = Symbol.for(
  'ultras.SubscriptionErasureHandler',
);

const UltrasAccountDataEraser: unique symbol = Symbol.for(
  'ultras.UltrasAccountDataEraser',
);

export const EVENT_ULTRAS_TYPES = Object.freeze({
  RunActivationHandlersHandler,
  SubscriptionCancellationHandler,
  SubscriptionErasureHandler,
  UltrasAccountDataEraser,
});
