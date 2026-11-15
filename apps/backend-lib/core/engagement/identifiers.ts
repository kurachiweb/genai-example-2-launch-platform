const CommentStore: unique symbol = Symbol.for('engagement.CommentStore');
const CommentStatements: unique symbol = Symbol.for(
  'engagement.CommentStatements',
);
const CommentThreadQuery: unique symbol = Symbol.for(
  'engagement.CommentThreadQuery',
);
const RatingStore: unique symbol = Symbol.for('engagement.RatingStore');
const RatingStatements: unique symbol = Symbol.for(
  'engagement.RatingStatements',
);
const EngagementErasureStore: unique symbol = Symbol.for(
  'engagement.EngagementErasureStore',
);
const CommentExport: unique symbol = Symbol.for('engagement.CommentExport');
const RatingExport: unique symbol = Symbol.for('engagement.RatingExport');
const AdminCommentDirectory: unique symbol = Symbol.for(
  'engagement.AdminCommentDirectory',
);
const AdminRatingDirectory: unique symbol = Symbol.for(
  'engagement.AdminRatingDirectory',
);

// CommentStatements・RatingStatementsの型はデータベースの型を持つためworkers/engagementにあり、apiのinfrastructure層だけが受け取る
export const ENGAGEMENT_PLATFORM_TYPES = Object.freeze({
  CommentStore,
  CommentStatements,
  CommentThreadQuery,
  RatingStore,
  RatingStatements,
  EngagementErasureStore,
  CommentExport,
  RatingExport,
  AdminCommentDirectory,
  AdminRatingDirectory,
});
