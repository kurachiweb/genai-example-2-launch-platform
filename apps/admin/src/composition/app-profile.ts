import type { FrontendAppProfile } from '../../lib/server/entry/app-profile.ts';

export const ADMIN_PROFILE: FrontendAppProfile = Object.freeze({
  caller: 'admin',
  sessionCookieName: '__Host-ls_admin_session',
  indexable: () => false,
  webAnalytics: false,
});
