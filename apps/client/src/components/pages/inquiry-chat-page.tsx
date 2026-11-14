import { Button } from '../../../lib/components/ui/button/button.tsx';
import { EmptyState } from '../../../lib/components/state/empty-state.tsx';
import { ErrorState } from '../../../lib/components/state/error-state.tsx';
import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import {
  BACK_TO_CONTACT_LABEL,
  INQUIRY_CHAT_PAGE_TITLE,
  INQUIRY_NOT_FOUND_DESCRIPTION,
  INQUIRY_NOT_FOUND_MESSAGE,
} from '../inquiry/inquiry-chat-messages.ts';
import { InquiryChatView } from '../inquiry/inquiry-chat-view.tsx';
import { INQUIRY_CHAT_HEADING_ID } from '../inquiry/use-inquiry-chat-retry.ts';
import { CONTACT_HREF } from '../layout/site-links.ts';

export type InquiryChatPageState =
  | { readonly status: 'pending' }
  | {
      readonly status: 'error';
      readonly error: unknown;
      readonly onRetry: () => void;
    }
  | { readonly status: 'not-found' }
  | {
      readonly status: 'success';
      readonly viewer: ClientViewer;
      readonly inquiryId: string;
    };

export interface InquiryChatPageProps {
  readonly state: InquiryChatPageState;
}

function InquiryChatContent({ state }: InquiryChatPageProps) {
  switch (state.status) {
    case 'pending':
      return <LoadingSkeleton />;
    case 'error':
      return (
        <ErrorState
          message={errorMessageOf(state.error, CLIENT_PROFILE.contactAvailable)}
          onRetry={state.onRetry}
          contactHref={CONTACT_HREF}
        />
      );
    case 'not-found':
      return (
        <EmptyState
          title={INQUIRY_NOT_FOUND_MESSAGE}
          description={INQUIRY_NOT_FOUND_DESCRIPTION}
          action={
            <Button asChild>
              <PathLink href={CONTACT_HREF}>{BACK_TO_CONTACT_LABEL}</PathLink>
            </Button>
          }
        />
      );
    case 'success':
      return (
        <InquiryChatView viewer={state.viewer} inquiryId={state.inquiryId} />
      );
  }
}

export function InquiryChatPage({ state }: InquiryChatPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      {/* 再試行で消える再試行のボタンからフォーカスを<body>へ落とさないよう、移り先としてプログラムからだけフォーカスできるようにする */}
      <h1
        id={INQUIRY_CHAT_HEADING_ID}
        tabIndex={-1}
        className="rounded-sm text-3xl font-extrabold tracking-tight sm:text-4xl"
      >
        {INQUIRY_CHAT_PAGE_TITLE}
      </h1>
      <InquiryChatContent state={state} />
    </div>
  );
}
