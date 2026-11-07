// backend-lib/core/ultrasのULTRAS_TYPESも同じultras.の接頭辞を使うため、メンバーの名前を重ねない
const UltrasPlanReader: unique symbol = Symbol.for('ultras.UltrasPlanReader');

const UltrasCheckout: unique symbol = Symbol.for('ultras.UltrasCheckout');

export const API_ULTRAS_TYPES = Object.freeze({
  UltrasPlanReader,
  UltrasCheckout,
});
