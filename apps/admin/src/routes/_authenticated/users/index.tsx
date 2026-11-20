import { createFileRoute } from '@tanstack/react-router';

import { MODERATION_PAGE_COPY } from '../../../components/moderation/shared/moderation-messages.ts';
import {
  toUserModerationSearch,
  userModerationListArgsOf,
} from '../../../components/moderation/shared/moderation-search.ts';
import { UsersPage } from '../../../components/pages/users-page.tsx';
import { loadAdminModerationUsersPage } from '../../../graphql/admin-moderation-users.ts';
import { buildAdminPageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/_authenticated/users/')({
  validateSearch: toUserModerationSearch,
  loaderDeps: ({ search }) => userModerationListArgsOf(search),
  loader: loadAdminModerationUsersPage,
  head: () => buildAdminPageHead({ title: MODERATION_PAGE_COPY.users.title }),
  component: UsersPage,
});
