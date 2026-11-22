// APIサーバーのDATA_EXPORT_TYPESとbackend-libのDATA_EXPORT_PLATFORM_TYPESも同じdata-export.の接頭辞を使うため、メンバーの名前を重ねない
const AccountSourceReader: unique symbol = Symbol.for(
  'data-export.AccountSourceReader',
);
const ProductActivitySourceReader: unique symbol = Symbol.for(
  'data-export.ProductActivitySourceReader',
);
const CorrespondenceSourceReader: unique symbol = Symbol.for(
  'data-export.CorrespondenceSourceReader',
);
const ExportFileResolver: unique symbol = Symbol.for(
  'data-export.ExportFileResolver',
);
const ExportSnapshotCollector: unique symbol = Symbol.for(
  'data-export.ExportSnapshotCollector',
);
const ArchiveGenerationService: unique symbol = Symbol.for(
  'data-export.ArchiveGenerationService',
);
const GenerateArchiveHandler: unique symbol = Symbol.for(
  'data-export.GenerateArchiveHandler',
);
const GenerationWatchdogHandler: unique symbol = Symbol.for(
  'data-export.GenerationWatchdogHandler',
);

export const EVENT_DATA_EXPORT_TYPES = Object.freeze({
  AccountSourceReader,
  ProductActivitySourceReader,
  CorrespondenceSourceReader,
  ExportFileResolver,
  ExportSnapshotCollector,
  ArchiveGenerationService,
  GenerateArchiveHandler,
  GenerationWatchdogHandler,
});
