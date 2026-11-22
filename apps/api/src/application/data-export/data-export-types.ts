const DataExportRequestLimits: unique symbol = Symbol.for(
  'data-export.DataExportRequestLimits',
);

const DataExportRequestService: unique symbol = Symbol.for(
  'data-export.DataExportRequestService',
);

const DataExportReader: unique symbol = Symbol.for(
  'data-export.DataExportReader',
);

export const DATA_EXPORT_TYPES = Object.freeze({
  DataExportRequestLimits,
  DataExportRequestService,
  DataExportReader,
});
