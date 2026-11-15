import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import {
  myInquirySearchAt,
  toMyInquirySearch,
} from '../components/inquiry/my-inquiry-search.ts';
import { ContactPage } from '../components/pages/contact-page.tsx';
import {
  inquiryContactQueryOptions,
  loadContactPage,
  toInquiryContactFormView,
} from '../graphql/inquiry-contact.ts';
import { buildContactHead } from '../head/page-heads.ts';

export const Route = createFileRoute('/contact')({
  validateSearch: toMyInquirySearch,
  loaderDeps: ({ search }) => search,
  loader: loadContactPage,
  head: () => buildContactHead(),
  component: ContactRoute,
});

function ContactRoute() {
  const { viewer } = Route.useRouteContext();
  const { after } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data } = useSuspenseQuery({
    ...inquiryContactQueryOptions(viewer),
    select: toInquiryContactFormView,
  });
  return (
    <ContactPage
      viewer={viewer}
      form={data}
      myInquiriesAfter={after}
      onShowMyInquiriesPage={(next) => {
        void navigate({ search: myInquirySearchAt(next) });
      }}
    />
  );
}
