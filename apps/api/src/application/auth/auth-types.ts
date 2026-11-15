const PasswordHasher: unique symbol = Symbol.for('auth.PasswordHasher');

const PwnedPasswordChecker: unique symbol = Symbol.for(
  'auth.PwnedPasswordChecker',
);

const PasswordPolicy: unique symbol = Symbol.for('auth.PasswordPolicy');

const SecretGenerator: unique symbol = Symbol.for('auth.SecretGenerator');

const SecretIssuer: unique symbol = Symbol.for('auth.SecretIssuer');

const SecretBox: unique symbol = Symbol.for('auth.SecretBox');

const TotpAuthenticator: unique symbol = Symbol.for('auth.TotpAuthenticator');

const RecoveryCodeIssuer: unique symbol = Symbol.for('auth.RecoveryCodeIssuer');

const LoginThrottle: unique symbol = Symbol.for('auth.LoginThrottle');

const AuthIncidentReporter: unique symbol = Symbol.for(
  'auth.AuthIncidentReporter',
);

const UserSessionVerifier: unique symbol = Symbol.for(
  'auth.UserSessionVerifier',
);

const AdminSessionVerifier: unique symbol = Symbol.for(
  'auth.AdminSessionVerifier',
);

export const AUTH_TYPES = Object.freeze({
  PasswordHasher,
  PwnedPasswordChecker,
  PasswordPolicy,
  SecretGenerator,
  SecretIssuer,
  SecretBox,
  TotpAuthenticator,
  RecoveryCodeIssuer,
  LoginThrottle,
  AuthIncidentReporter,
  UserSessionVerifier,
  AdminSessionVerifier,
});
