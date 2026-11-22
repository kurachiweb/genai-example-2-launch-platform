const DataExportRequestLimits: unique symbol = Symbol.for(
  'data-export.DataExportRequestLimits',
);

const DataExportRequestService: unique symbol = Symbol.for(
  'data-export.DataExportRequestService',
);

const DataExportReader: unique symbol = Symbol.for(
  'data-export.DataExportReader',
);

const ArchiveDownloadService: unique symbol = Symbol.for(
  'data-export.ArchiveDownloadService',
);

const ArchiveExpiryJob: unique symbol = Symbol.for(
  'data-export.ArchiveExpiryJob',
);

const GenerationRecoveryJob: unique symbol = Symbol.for(
  'data-export.GenerationRecoveryJob',
);

export const DATA_EXPORT_TYPES = Object.freeze({
  DataExportRequestLimits,
  DataExportRequestService,
  DataExportReader,
  ArchiveDownloadService,
  ArchiveExpiryJob,
  GenerationRecoveryJob,
});
