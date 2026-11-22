const DataExportStore: unique symbol = Symbol.for(
  'data-export.DataExportStore',
);
const ExportArchiveStorage: unique symbol = Symbol.for(
  'data-export.ExportArchiveStorage',
);
const DataExportNotifier: unique symbol = Symbol.for(
  'data-export.DataExportNotifier',
);
const DataExportTerminator: unique symbol = Symbol.for(
  'data-export.DataExportTerminator',
);
const DataExportIncidentReporter: unique symbol = Symbol.for(
  'data-export.DataExportIncidentReporter',
);

export const DATA_EXPORT_PLATFORM_TYPES = Object.freeze({
  DataExportStore,
  ExportArchiveStorage,
  DataExportNotifier,
  DataExportTerminator,
  DataExportIncidentReporter,
});
