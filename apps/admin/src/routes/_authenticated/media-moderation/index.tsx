import { createFileRoute } from '@tanstack/react-router';

import { MODERATION_PAGE_COPY } from '../../../components/moderation/shared/moderation-messages.ts';
import {
  quarantinedImageListArgsOf,
  toQuarantinedImageSearch,
} from '../../../components/moderation/shared/moderation-search.ts';
import { MediaModerationPage } from '../../../components/pages/media-moderation-page.tsx';
import { loadAdminQuarantinedImagesPage } from '../../../graphql/admin-quarantined-images.ts';
import { buildAdminPageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/_authenticated/media-moderation/')({
  validateSearch: toQuarantinedImageSearch,
  loaderDeps: ({ search }) => quarantinedImageListArgsOf(search),
  loader: loadAdminQuarantinedImagesPage,
  head: () =>
    buildAdminPageHead({ title: MODERATION_PAGE_COPY.mediaModeration.title }),
  component: MediaModerationPage,
});
