// backend-lib/core/engagementのENGAGEMENT_PLATFORM_TYPESも同じengagement.の接頭辞を使うため、メンバーの名前を重ねない
const EngagementTargetResolver: unique symbol = Symbol.for(
  'engagement.EngagementTargetResolver',
);

const CommentService: unique symbol = Symbol.for('engagement.CommentService');

const CommentReader: unique symbol = Symbol.for('engagement.CommentReader');

const RatingService: unique symbol = Symbol.for('engagement.RatingService');

const CommentWriter: unique symbol = Symbol.for('engagement.CommentWriter');

const RatingWriter: unique symbol = Symbol.for('engagement.RatingWriter');

const CommentModerationControl: unique symbol = Symbol.for(
  'engagement.CommentModerationControl',
);

const RatingModerationControl: unique symbol = Symbol.for(
  'engagement.RatingModerationControl',
);

const CommentCountMetricSource: unique symbol = Symbol.for(
  'engagement.CommentCountMetricSource',
);

const EngagementWithdrawalSyncHandler: unique symbol = Symbol.for(
  'engagement.EngagementWithdrawalSyncHandler',
);

const CommentAnonymizationJob: unique symbol = Symbol.for(
  'engagement.CommentAnonymizationJob',
);

export const ENGAGEMENT_TYPES = Object.freeze({
  EngagementTargetResolver,
  CommentService,
  CommentReader,
  RatingService,
  CommentWriter,
  RatingWriter,
  CommentModerationControl,
  RatingModerationControl,
  CommentCountMetricSource,
  EngagementWithdrawalSyncHandler,
  CommentAnonymizationJob,
});
