const ModerateImageHandler: unique symbol = Symbol.for(
  'media.ModerateImageHandler',
);
const RelocateFilesHandler: unique symbol = Symbol.for(
  'media.RelocateFilesHandler',
);
const PurgeImageCacheHandler: unique symbol = Symbol.for(
  'media.PurgeImageCacheHandler',
);

export const EVENT_MEDIA_HANDLER_TYPES = Object.freeze({
  ModerateImageHandler,
  RelocateFilesHandler,
  PurgeImageCacheHandler,
});
