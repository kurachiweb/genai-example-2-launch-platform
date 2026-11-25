import { createFileRoute } from '@tanstack/react-router';

import { MODERATION_PAGE_COPY } from '../../../components/moderation/shared/moderation-messages.ts';
import {
  ratingModerationListArgsOf,
  toRatingModerationSearch,
} from '../../../components/moderation/shared/moderation-search.ts';
import { RatingsPage } from '../../../components/pages/ratings-page.tsx';
import { loadAdminModerationRatingsPage } from '../../../graphql/admin-moderation-engagement.ts';
import { buildAdminPageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/_authenticated/ratings/')({
  validateSearch: toRatingModerationSearch,
  loaderDeps: ({ search }) => ratingModerationListArgsOf(search),
  loader: loadAdminModerationRatingsPage,
  head: () => buildAdminPageHead({ title: MODERATION_PAGE_COPY.ratings.title }),
  component: RatingsPage,
});
