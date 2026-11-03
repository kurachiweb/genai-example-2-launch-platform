const AuditActionCatalog: unique symbol = Symbol.for(
  'admin.AuditActionCatalog',
);

const AuditLogStore: unique symbol = Symbol.for('admin.AuditLogStore');

const AuditLogRecorder: unique symbol = Symbol.for('admin.AuditLogRecorder');

const AuditLogReader: unique symbol = Symbol.for('admin.AuditLogReader');

const AdminAccountStore: unique symbol = Symbol.for('admin.AdminAccountStore');

const AdminSessionStore: unique symbol = Symbol.for('admin.AdminSessionStore');

const AdminSessionIssuer: unique symbol = Symbol.for(
  'admin.AdminSessionIssuer',
);

const AdminSessionVerifier: unique symbol = Symbol.for(
  'admin.AdminSessionVerifier',
);

const AdminAuthTokenStore: unique symbol = Symbol.for(
  'admin.AdminAuthTokenStore',
);

const AdminLoginChallengeStore: unique symbol = Symbol.for(
  'admin.AdminLoginChallengeStore',
);

const AdminTotpCredentialStore: unique symbol = Symbol.for(
  'admin.AdminTotpCredentialStore',
);

const AdminRecoveryCodeStore: unique symbol = Symbol.for(
  'admin.AdminRecoveryCodeStore',
);

const AdminMailer: unique symbol = Symbol.for('admin.AdminMailer');

const AdminSettings: unique symbol = Symbol.for('admin.AdminSettings');

const AdminMailSendLimits: unique symbol = Symbol.for(
  'admin.AdminMailSendLimits',
);

const AdminAuthorizer: unique symbol = Symbol.for('admin.AdminAuthorizer');

export const ADMIN_TYPES = Object.freeze({
  AuditActionCatalog,
  AuditLogStore,
  AuditLogRecorder,
  AuditLogReader,
  AdminAccountStore,
  AdminSessionStore,
  AdminSessionIssuer,
  AdminSessionVerifier,
  AdminAuthTokenStore,
  AdminLoginChallengeStore,
  AdminTotpCredentialStore,
  AdminRecoveryCodeStore,
  AdminMailer,
  AdminSettings,
  AdminMailSendLimits,
  AdminAuthorizer,
});
