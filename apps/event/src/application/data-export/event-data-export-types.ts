// APIサーバーのDATA_EXPORT_TYPESとbackend-libのDATA_EXPORT_PLATFORM_TYPESも同じdata-export.の接頭辞を使うため、メンバーの名前を重ねない
const AccountSourceReader: unique symbol = Symbol.for(
  'data-export.AccountSourceReader',
);
const CorrespondenceSourceReader: unique symbol = Symbol.for(
  'data-export.CorrespondenceSourceReader',
);

export const EVENT_DATA_EXPORT_TYPES = Object.freeze({
  AccountSourceReader,
  CorrespondenceSourceReader,
});
