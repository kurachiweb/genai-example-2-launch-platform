import { createFileRoute } from '@tanstack/react-router';

import { INQUIRIES_TITLE } from '../../../components/inquiry/admin-inquiries-messages.ts';
import { toAdminInquirySearch } from '../../../components/inquiry/admin-inquiry-search.ts';
import { InquiriesPage } from '../../../components/pages/inquiries-page.tsx';
import { loadAdminInquiriesPage } from '../../../graphql/admin-inquiries.ts';
import { buildAdminPageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/_authenticated/inquiries/')({
  validateSearch: toAdminInquirySearch,
  loaderDeps: ({ search }) => search,
  loader: loadAdminInquiriesPage,
  head: () => buildAdminPageHead({ title: INQUIRIES_TITLE }),
  component: InquiriesPage,
});
