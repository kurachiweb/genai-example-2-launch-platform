// apiのADMIN_TYPESも同じadmin.の接頭辞を使うため、メンバーの名前を重ねない
const AdminDirectory: unique symbol = Symbol.for('admin.AdminDirectory');

const AuditLogRecorder: unique symbol = Symbol.for('admin.AuditLogRecorder');

export const ADMIN_PLATFORM_TYPES = Object.freeze({
  AdminDirectory,
  AuditLogRecorder,
});
