// apiのADMIN_TYPESも同じadmin.の接頭辞を使うため、メンバーの名前を重ねない
const AdminDirectory: unique symbol = Symbol.for('admin.AdminDirectory');

export const ADMIN_PLATFORM_TYPES = Object.freeze({
  AdminDirectory,
});
