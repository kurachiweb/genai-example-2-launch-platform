import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, notFound } from '@tanstack/react-router';

import type { FollowState } from '../components/profile/follow-button-types.ts';
import { ProfileSkeleton } from '../components/profile/profile-skeleton.tsx';
import { PublicProfileError } from '../components/profile/public-profile-error.tsx';
import { PublicProfilePage } from '../components/profile/public-profile-page.tsx';
import {
  type PublicProfileSearch,
  toPublicProfileSearch,
} from '../components/profile/public-profile-search.ts';
import {
  loadPublicProfile,
  publicProfileQueryOptions,
  toPublicProfileView,
  withFollowState,
} from '../graphql/public-profile.ts';
import { buildPublicProfileHead } from '../head/page-heads.ts';

export const Route = createFileRoute('/@{$handle}')({
  validateSearch: toPublicProfileSearch,
  loader: loadPublicProfile,
  head: ({ loaderData }) => buildPublicProfileHead(loaderData),
  pendingComponent: ProfileSkeleton,
  errorComponent: PublicProfileError,
  component: PublicProfileRoute,
});

function PublicProfileRoute() {
  const { handle } = Route.useParams();
  const { viewer } = Route.useRouteContext();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const options = publicProfileQueryOptions(viewer, handle);
  const { data: profile } = useSuspenseQuery({
    ...options,
    select: toPublicProfileView,
  });
  if (profile === undefined) {
    throw notFound();
  }

  const handleFollowChange = (state: FollowState) => {
    queryClient.setQueryData(options.queryKey, (data) =>
      withFollowState(data, state),
    );
  };
  const handleTabChange = (next: string | undefined) => {
    void navigate({
      to: '.',
      search: (previous: PublicProfileSearch) => ({ ...previous, tab: next }),
      resetScroll: false,
    });
  };

  return (
    <PublicProfilePage
      key={profile.handle}
      profile={profile}
      tab={tab}
      onTabChange={handleTabChange}
      onFollowChange={handleFollowChange}
    />
  );
}
