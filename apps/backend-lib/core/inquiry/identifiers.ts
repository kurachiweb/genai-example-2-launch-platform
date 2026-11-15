// APIサーバーのINQUIRY_TYPESとイベントサーバーのEVENT_INQUIRY_TYPESも同じinquiry.の接頭辞を使うため、メンバーの名前を重ねない
const InquiryExport: unique symbol = Symbol.for('inquiry.InquiryExport');

export const INQUIRY_EXPORT_TYPES = Object.freeze({
  InquiryExport,
});
