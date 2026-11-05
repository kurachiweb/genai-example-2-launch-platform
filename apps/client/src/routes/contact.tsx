import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { ContactPage } from '../components/pages/contact-page.tsx';
import {
  inquiryContactQueryOptions,
  loadContactPage,
  toInquiryContactFormView,
} from '../graphql/inquiry-contact.ts';
import { buildContactHead } from '../head/page-heads.ts';

export const Route = createFileRoute('/contact')({
  loader: loadContactPage,
  head: () => buildContactHead(),
  component: ContactRoute,
});

function ContactRoute() {
  const { viewer } = Route.useRouteContext();
  const { data } = useSuspenseQuery({
    ...inquiryContactQueryOptions(viewer),
    select: toInquiryContactFormView,
  });
  return <ContactPage viewer={viewer} form={data} />;
}
