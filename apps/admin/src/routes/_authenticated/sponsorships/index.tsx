import { createFileRoute } from '@tanstack/react-router';

import { SponsorshipsPage } from '../../../components/pages/sponsorships-page.tsx';
import { toAdminSponsorshipSearch } from '../../../components/sponsorship/admin-sponsorship-search.ts';
import { SPONSORSHIPS_TITLE } from '../../../components/sponsorship/admin-sponsorships-messages.ts';
import { loadAdminSponsorshipsPage } from '../../../graphql/admin-sponsorships.ts';
import { buildAdminPageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/_authenticated/sponsorships/')({
  validateSearch: toAdminSponsorshipSearch,
  loaderDeps: ({ search }) => search,
  loader: loadAdminSponsorshipsPage,
  head: () => buildAdminPageHead({ title: SPONSORSHIPS_TITLE }),
  component: SponsorshipsPage,
});
