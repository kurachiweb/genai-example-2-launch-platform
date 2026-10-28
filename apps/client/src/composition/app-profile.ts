import type {
  AppEnvironment,
  FrontendAppProfile,
} from '../../lib/server/entry/app-profile.ts';

export const CLIENT_PROFILE: FrontendAppProfile = Object.freeze({
  caller: 'client',
  sessionCookieName: '__Host-ls_session',
  indexable: (environment: AppEnvironment) => environment === 'prod',
  webAnalytics: true,
  contactAvailable: true,
});
