// backend-lib/core/moderationの識別子がmoderation.の接頭辞を使い、eventがmoderation.event.を使うため、APIサーバーの識別子はmoderation.api.で分ける
const UserModerationService: unique symbol = Symbol.for(
  'moderation.api.UserModerationService',
);
const AdministrativeWithdrawalService: unique symbol = Symbol.for(
  'moderation.api.AdministrativeWithdrawalService',
);
const ProductModerationService: unique symbol = Symbol.for(
  'moderation.api.ProductModerationService',
);
const CommentModerationService: unique symbol = Symbol.for(
  'moderation.api.CommentModerationService',
);
const RatingModerationService: unique symbol = Symbol.for(
  'moderation.api.RatingModerationService',
);
const ImageModerationService: unique symbol = Symbol.for(
  'moderation.api.ImageModerationService',
);
const ModerationNotifier: unique symbol = Symbol.for(
  'moderation.api.ModerationNotifier',
);
const AdminUserReader: unique symbol = Symbol.for(
  'moderation.api.AdminUserReader',
);
const AdminProductReader: unique symbol = Symbol.for(
  'moderation.api.AdminProductReader',
);
const AdminCommentReader: unique symbol = Symbol.for(
  'moderation.api.AdminCommentReader',
);
const AdminRatingReader: unique symbol = Symbol.for(
  'moderation.api.AdminRatingReader',
);
const QuarantinedImageReader: unique symbol = Symbol.for(
  'moderation.api.QuarantinedImageReader',
);
const ModerationMaintenanceJob: unique symbol = Symbol.for(
  'moderation.api.ModerationMaintenanceJob',
);
const ImageModerationWriter: unique symbol = Symbol.for(
  'moderation.api.ImageModerationWriter',
);
const EngagementModerationWriter: unique symbol = Symbol.for(
  'moderation.api.EngagementModerationWriter',
);
const ModerationIncidentReporter: unique symbol = Symbol.for(
  'moderation.api.ModerationIncidentReporter',
);
const ModerationStatements: unique symbol = Symbol.for(
  'moderation.api.ModerationStatements',
);
const PendingModerationRecord: unique symbol = Symbol.for(
  'moderation.api.PendingModerationRecord',
);
const UserModerationRecordSyncHandler: unique symbol = Symbol.for(
  'moderation.api.UserModerationRecordSyncHandler',
);
const ProductModerationRecordSyncHandler: unique symbol = Symbol.for(
  'moderation.api.ProductModerationRecordSyncHandler',
);
const ModerationWriteParticipants: unique symbol = Symbol.for(
  'moderation.api.ModerationWriteParticipants',
);

export const MODERATION_TYPES = Object.freeze({
  UserModerationService,
  AdministrativeWithdrawalService,
  ProductModerationService,
  CommentModerationService,
  RatingModerationService,
  ImageModerationService,
  ModerationNotifier,
  AdminUserReader,
  AdminProductReader,
  AdminCommentReader,
  AdminRatingReader,
  QuarantinedImageReader,
  ModerationMaintenanceJob,
  ImageModerationWriter,
  EngagementModerationWriter,
  ModerationIncidentReporter,
  ModerationStatements,
  PendingModerationRecord,
  UserModerationRecordSyncHandler,
  ProductModerationRecordSyncHandler,
  ModerationWriteParticipants,
});
