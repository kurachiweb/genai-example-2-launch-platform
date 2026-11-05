// backend-lib/core/inquiryのINQUIRY_EXPORT_TYPESも同じinquiry.の接頭辞を使うため、メンバーの名前を重ねない
const InquiryCategoryStore: unique symbol = Symbol.for(
  'inquiry.InquiryCategoryStore',
);

const GuestInquiryStore: unique symbol = Symbol.for(
  'inquiry.GuestInquiryStore',
);

const MemberInquiryStore: unique symbol = Symbol.for(
  'inquiry.MemberInquiryStore',
);

const InquiryStatusStore: unique symbol = Symbol.for(
  'inquiry.InquiryStatusStore',
);

const InquiryAdminReader: unique symbol = Symbol.for(
  'inquiry.InquiryAdminReader',
);

const InquirerProfiles: unique symbol = Symbol.for('inquiry.InquirerProfiles');

const InquiryMailer: unique symbol = Symbol.for('inquiry.InquiryMailer');

const InquirySettings: unique symbol = Symbol.for('inquiry.InquirySettings');

const InquiryIncidentReporter: unique symbol = Symbol.for(
  'inquiry.InquiryIncidentReporter',
);

const GuestInquiryRateLimit: unique symbol = Symbol.for(
  'inquiry.GuestInquiryRateLimit',
);

const InquiryCategoryService: unique symbol = Symbol.for(
  'inquiry.InquiryCategoryService',
);

const GuestInquirySubmission: unique symbol = Symbol.for(
  'inquiry.GuestInquirySubmission',
);

const MemberInquirySubmission: unique symbol = Symbol.for(
  'inquiry.MemberInquirySubmission',
);

const InquiryAttachmentBinder: unique symbol = Symbol.for(
  'inquiry.InquiryAttachmentBinder',
);

const InquiryChatService: unique symbol = Symbol.for(
  'inquiry.InquiryChatService',
);

const InquiryAdminService: unique symbol = Symbol.for(
  'inquiry.InquiryAdminService',
);

const InquiryReplyService: unique symbol = Symbol.for(
  'inquiry.InquiryReplyService',
);

const InquiryStatusService: unique symbol = Symbol.for(
  'inquiry.InquiryStatusService',
);

const GuestInquiryRetentionJob: unique symbol = Symbol.for(
  'inquiry.GuestInquiryRetentionJob',
);

export const INQUIRY_TYPES = Object.freeze({
  InquiryCategoryStore,
  GuestInquiryStore,
  MemberInquiryStore,
  InquiryStatusStore,
  InquiryAdminReader,
  InquirerProfiles,
  InquiryMailer,
  InquirySettings,
  InquiryIncidentReporter,
  GuestInquiryRateLimit,
  InquiryCategoryService,
  GuestInquirySubmission,
  MemberInquirySubmission,
  InquiryAttachmentBinder,
  InquiryChatService,
  InquiryAdminService,
  InquiryReplyService,
  InquiryStatusService,
  GuestInquiryRetentionJob,
});
