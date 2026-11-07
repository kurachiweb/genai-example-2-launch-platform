// backend-lib/core/ultrasのULTRAS_TYPESも同じultras.の接頭辞を使うため、メンバーの名前を重ねない
const UltrasPlanReader: unique symbol = Symbol.for('ultras.UltrasPlanReader');

const UltrasCheckout: unique symbol = Symbol.for('ultras.UltrasCheckout');

const PortalSessionStarter: unique symbol = Symbol.for(
  'ultras.PortalSessionStarter',
);

const PortalSessionLimits: unique symbol = Symbol.for(
  'ultras.PortalSessionLimits',
);

const PromotionSettingReader: unique symbol = Symbol.for(
  'ultras.PromotionSettingReader',
);

const PromotionSettingWriter: unique symbol = Symbol.for(
  'ultras.PromotionSettingWriter',
);

const PromotionSettingService: unique symbol = Symbol.for(
  'ultras.PromotionSettingService',
);

export const API_ULTRAS_TYPES = Object.freeze({
  UltrasPlanReader,
  UltrasCheckout,
  PortalSessionStarter,
  PortalSessionLimits,
  PromotionSettingReader,
  PromotionSettingWriter,
  PromotionSettingService,
});
