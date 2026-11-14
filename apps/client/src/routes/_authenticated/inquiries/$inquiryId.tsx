import {
  createFileRoute,
  type ErrorComponentProps,
} from '@tanstack/react-router';

import { useInquiryChatRetry } from '../../../components/inquiry/use-inquiry-chat-retry.ts';
import { InquiryChatPage } from '../../../components/pages/inquiry-chat-page.tsx';
import { loadInquiryChatPage } from '../../../graphql/inquiry-chat.ts';
import { buildInquiryChatHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/_authenticated/inquiries/$inquiryId')({
  loader: loadInquiryChatPage,
  head: () => buildInquiryChatHead(),
  pendingComponent: InquiryChatPending,
  errorComponent: InquiryChatError,
  notFoundComponent: InquiryChatNotFound,
  component: InquiryChatRoute,
});

function InquiryChatRoute() {
  const { viewer } = Route.useRouteContext();
  const { inquiryId } = Route.useParams();
  return <InquiryChatPage state={{ status: 'success', viewer, inquiryId }} />;
}

function InquiryChatPending() {
  return <InquiryChatPage state={{ status: 'pending' }} />;
}

function InquiryChatError({ error }: ErrorComponentProps) {
  const retry = useInquiryChatRetry();
  return <InquiryChatPage state={{ status: 'error', error, onRetry: retry }} />;
}

function InquiryChatNotFound() {
  return <InquiryChatPage state={{ status: 'not-found' }} />;
}
