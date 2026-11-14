// APIサーバーのINQUIRY_TYPESとbackend-lib/core/inquiryの識別子がinquiry.の接頭辞を使うため、イベントサーバーの識別子はinquiry.event.で分ける
const MemberInquiryPurgeStore: unique symbol = Symbol.for(
  'inquiry.event.MemberInquiryPurgeStore',
);
const MemberInquiryPurgeHandler: unique symbol = Symbol.for(
  'inquiry.event.MemberInquiryPurgeHandler',
);

export const EVENT_INQUIRY_TYPES = Object.freeze({
  MemberInquiryPurgeStore,
  MemberInquiryPurgeHandler,
});
