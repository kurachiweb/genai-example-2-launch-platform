const ModerationRecordStore: unique symbol = Symbol.for(
  'moderation.ModerationRecordStore',
);
const ModerationRecordStatements: unique symbol = Symbol.for(
  'moderation.ModerationRecordStatements',
);

export const MODERATION_PLATFORM_TYPES = Object.freeze({
  ModerationRecordStore,
  ModerationRecordStatements,
});
