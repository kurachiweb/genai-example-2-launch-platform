const ReportErasureStore: unique symbol = Symbol.for(
  'reporting.ReportErasureStore',
);
const ReportErasureStatements: unique symbol = Symbol.for(
  'reporting.ReportErasureStatements',
);
const ReportExport: unique symbol = Symbol.for('reporting.ReportExport');

export const REPORTING_PLATFORM_TYPES = Object.freeze({
  ReportErasureStore,
  ReportErasureStatements,
  ReportExport,
});
