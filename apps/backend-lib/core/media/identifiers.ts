const MediaFiles: unique symbol = Symbol.for('media.MediaFiles');
const MediaQuarantine: unique symbol = Symbol.for('media.MediaQuarantine');
const MediaEraser: unique symbol = Symbol.for('media.MediaEraser');
const UploadReceiver: unique symbol = Symbol.for('media.UploadReceiver');
const MediaFileStore: unique symbol = Symbol.for('media.MediaFileStore');
const MediaObjectStore: unique symbol = Symbol.for('media.MediaObjectStore');
const UploadPurposeRegistry: unique symbol = Symbol.for(
  'media.UploadPurposeRegistry',
);

export const MEDIA_TYPES = Object.freeze({
  MediaFiles,
  MediaQuarantine,
  MediaEraser,
  UploadReceiver,
  MediaFileStore,
  MediaObjectStore,
  UploadPurposeRegistry,
});
