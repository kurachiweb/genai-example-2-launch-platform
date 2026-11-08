import { createFileRoute } from '@tanstack/react-router';

import { PROFILE_EDIT_PAGE_TITLE } from '../../../components/profile/profile-form-messages.ts';
import { ProfileEditPage } from '../../../components/profile/profile-edit-page.tsx';
import { loadMyProfile } from '../../../graphql/my-profile.ts';
import { buildSitePageHead } from '../../../head/page-heads.ts';

// 設定の経路のレイアウトがSettingsShellで包むため、ここでは包み直さない。本人だけが読むページのため、検索の索引の対象外にする
export const Route = createFileRoute('/_authenticated/settings/profile')({
  loader: loadMyProfile,
  head: () =>
    buildSitePageHead({ title: PROFILE_EDIT_PAGE_TITLE, noIndex: true }),
  component: ProfileSettingsRoute,
});

function ProfileSettingsRoute() {
  const { viewer } = Route.useRouteContext();
  return <ProfileEditPage viewer={viewer} />;
}
