import { createFileRoute } from '@tanstack/react-router';

import { FOLLOW_LIST_PAGE_TITLE } from '../../../components/profile/follow-list-messages.ts';
import { FollowListPage } from '../../../components/profile/follow-list-page.tsx';
import {
  followListDirectionOf,
  followListTabQueryValue,
  type FollowListSearch,
  toFollowListSearch,
} from '../../../components/profile/follow-list-search.ts';
import { loadFollowList } from '../../../graphql/follow-list.ts';
import { buildSitePageHead } from '../../../head/page-heads.ts';

// 設定の経路のレイアウトがSettingsShellで包むため、ここでは包み直さない。本人だけが読むページのため、検索の索引の対象外にする
export const Route = createFileRoute('/_authenticated/settings/follows')({
  validateSearch: toFollowListSearch,
  loaderDeps: ({ search }) => ({ tab: search.tab }),
  loader: ({ context, deps }) =>
    loadFollowList({ context, direction: followListDirectionOf(deps.tab) }),
  head: () =>
    buildSitePageHead({ title: FOLLOW_LIST_PAGE_TITLE, noIndex: true }),
  component: FollowsSettingsRoute,
});

function FollowsSettingsRoute() {
  const { viewer } = Route.useRouteContext();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <FollowListPage
      viewerId={viewer.id}
      direction={followListDirectionOf(tab)}
      onDirectionChange={(direction) => {
        void navigate({
          to: '.',
          search: (previous: FollowListSearch) => ({
            ...previous,
            tab: followListTabQueryValue(direction),
          }),
          resetScroll: false,
        });
      }}
    />
  );
}
