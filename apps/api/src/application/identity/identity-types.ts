const UserAccountStore: unique symbol = Symbol.for('identity.UserAccountStore');

const UserSessionStore: unique symbol = Symbol.for('identity.UserSessionStore');

const AuthTokenStore: unique symbol = Symbol.for('identity.AuthTokenStore');

const LoginChallengeStore: unique symbol = Symbol.for(
  'identity.LoginChallengeStore',
);

const TotpCredentialStore: unique symbol = Symbol.for(
  'identity.TotpCredentialStore',
);

const RecoveryCodeStore: unique symbol = Symbol.for(
  'identity.RecoveryCodeStore',
);

const UserLifecycleCommitter: unique symbol = Symbol.for(
  'identity.UserLifecycleCommitter',
);

const UserLifecycleStore: unique symbol = Symbol.for(
  'identity.UserLifecycleStore',
);

const HandleAvailability: unique symbol = Symbol.for(
  'identity.HandleAvailability',
);

const DisposableEmailChecker: unique symbol = Symbol.for(
  'identity.DisposableEmailChecker',
);

const DeviceDescriber: unique symbol = Symbol.for('identity.DeviceDescriber');

const IdentityMailer: unique symbol = Symbol.for('identity.IdentityMailer');

const IdentitySettings: unique symbol = Symbol.for('identity.IdentitySettings');

const SessionIssuer: unique symbol = Symbol.for('identity.SessionIssuer');

const AccountGuard: unique symbol = Symbol.for('identity.AccountGuard');

const MailSendLimits: unique symbol = Symbol.for('identity.MailSendLimits');

const Registration: unique symbol = Symbol.for('identity.Registration');

const EmailVerification: unique symbol = Symbol.for(
  'identity.EmailVerification',
);

const DisposableEmailCheck: unique symbol = Symbol.for(
  'identity.DisposableEmailCheck',
);

const Login: unique symbol = Symbol.for('identity.Login');

const ReAuthenticator: unique symbol = Symbol.for('identity.ReAuthenticator');

const SessionManagement: unique symbol = Symbol.for(
  'identity.SessionManagement',
);

const PasswordReset: unique symbol = Symbol.for('identity.PasswordReset');

const EmailChange: unique symbol = Symbol.for('identity.EmailChange');

const PasswordChange: unique symbol = Symbol.for('identity.PasswordChange');

const TotpManagement: unique symbol = Symbol.for('identity.TotpManagement');

const Withdrawal: unique symbol = Symbol.for('identity.Withdrawal');

const AdministrativeWithdrawal: unique symbol = Symbol.for(
  'identity.AdministrativeWithdrawal',
);

const UserSuspension: unique symbol = Symbol.for('identity.UserSuspension');

const AccountUploaderEligibility: unique symbol = Symbol.for(
  'identity.AccountUploaderEligibility',
);

const PurgeOrchestratorJob: unique symbol = Symbol.for(
  'identity.PurgeOrchestratorJob',
);

const LifecycleRedispatchJob: unique symbol = Symbol.for(
  'identity.LifecycleRedispatchJob',
);

const CredentialCleanupJob: unique symbol = Symbol.for(
  'identity.CredentialCleanupJob',
);

const DisposableRecheckSweepJob: unique symbol = Symbol.for(
  'identity.DisposableRecheckSweepJob',
);

export const IDENTITY_TYPES = Object.freeze({
  UserAccountStore,
  UserSessionStore,
  AuthTokenStore,
  LoginChallengeStore,
  TotpCredentialStore,
  RecoveryCodeStore,
  UserLifecycleCommitter,
  UserLifecycleStore,
  HandleAvailability,
  DisposableEmailChecker,
  DeviceDescriber,
  IdentityMailer,
  IdentitySettings,
  SessionIssuer,
  AccountGuard,
  MailSendLimits,
  Registration,
  EmailVerification,
  DisposableEmailCheck,
  Login,
  ReAuthenticator,
  SessionManagement,
  PasswordReset,
  EmailChange,
  PasswordChange,
  TotpManagement,
  Withdrawal,
  AdministrativeWithdrawal,
  UserSuspension,
  AccountUploaderEligibility,
  PurgeOrchestratorJob,
  LifecycleRedispatchJob,
  CredentialCleanupJob,
  DisposableRecheckSweepJob,
});
