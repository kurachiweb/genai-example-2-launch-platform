const UserContactDirectory: unique symbol = Symbol.for(
  'identity.UserContactDirectory',
);

const AccountExport: unique symbol = Symbol.for('identity.AccountExport');

export const IDENTITY_PLATFORM_TYPES = Object.freeze({
  UserContactDirectory,
  AccountExport,
});
