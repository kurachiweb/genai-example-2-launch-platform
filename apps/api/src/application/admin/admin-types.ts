const AuditActionCatalog: unique symbol = Symbol.for(
  'admin.AuditActionCatalog',
);

const AuditLogStore: unique symbol = Symbol.for('admin.AuditLogStore');

const AuditLogRecorder: unique symbol = Symbol.for('admin.AuditLogRecorder');

const AuditLogReader: unique symbol = Symbol.for('admin.AuditLogReader');

export const ADMIN_TYPES = Object.freeze({
  AuditActionCatalog,
  AuditLogStore,
  AuditLogRecorder,
  AuditLogReader,
});
