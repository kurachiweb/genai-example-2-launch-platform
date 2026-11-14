import { type ReactNode, useRef } from 'react';

import { ErrorState } from '../../../lib/components/state/error-state.tsx';
import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { CONTACT_HREF } from '../layout/site-links.ts';
import { LEGAL_PAGE_HEADING_ID } from './use-legal-page-retry.ts';

export type LegalPageState<TSuccess extends object> =
  | { readonly status: 'pending' }
  | {
      readonly status: 'error';
      readonly error: unknown;
      readonly onRetry: () => void;
    }
  | ({ readonly status: 'success' } & TSuccess);

export interface LegalPageFrameProps {
  readonly title: string;
  readonly state: LegalPageState<object>;
  readonly children?: ReactNode;
}

export function LegalPageFrame({
  title,
  state,
  children,
}: LegalPageFrameProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  const content = (() => {
    switch (state.status) {
      case 'pending':
        return <LoadingSkeleton className="mt-8" />;
      case 'error':
        return (
          <ErrorState
            className="mt-8"
            message={errorMessageOf(
              state.error,
              CLIENT_PROFILE.contactAvailable,
            )}
            onRetry={() => {
              headingRef.current?.focus();
              state.onRetry();
            }}
            contactHref={CONTACT_HREF}
          />
        );
      case 'success':
        return children;
    }
  })();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      {/* 再試行で消える再試行のボタンからフォーカスを<body>へ落とさないよう、移り先としてプログラムからだけフォーカスできるようにする */}
      <h1
        ref={headingRef}
        id={LEGAL_PAGE_HEADING_ID}
        tabIndex={-1}
        className="rounded-sm text-3xl font-extrabold tracking-tight sm:text-4xl"
      >
        {title}
      </h1>
      {content}
    </div>
  );
}
