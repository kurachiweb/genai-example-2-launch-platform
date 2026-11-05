import { createFileRoute } from '@tanstack/react-router';

import { INQUIRY_DETAIL_TITLE } from '../../../components/inquiry/admin-inquiries-messages.ts';
import { InquiryDetailPage } from '../../../components/pages/inquiry-detail-page.tsx';
import { loadAdminInquiryPage } from '../../../graphql/admin-inquiries.ts';
import { buildAdminPageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/_authenticated/inquiries/$inquiryId')({
  loader: loadAdminInquiryPage,
  head: () => buildAdminPageHead({ title: INQUIRY_DETAIL_TITLE }),
  component: InquiryDetailPage,
});
