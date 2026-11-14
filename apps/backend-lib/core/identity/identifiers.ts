const UserContactDirectory: unique symbol = Symbol.for(
  'identity.UserContactDirectory',
);

const AccountExport: unique symbol = Symbol.for('identity.AccountExport');

const AdminUserDirectory: unique symbol = Symbol.for(
  'identity.AdminUserDirectory',
);

const AccountGuard: unique symbol = Symbol.for('identity.AccountGuard');

export const IDENTITY_PLATFORM_TYPES = Object.freeze({
  UserContactDirectory,
  AccountExport,
  AdminUserDirectory,
  AccountGuard,
});
