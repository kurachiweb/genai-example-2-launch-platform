import { CatchBoundary } from '@tanstack/react-router';
import { Suspense } from 'react';

import { cn } from '../../../lib/utilities/class-names.ts';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { PROFILE_TAB_COUNT_UNIT } from './profile-messages.ts';
import type {
  PublicProfileSectionComponent,
  PublicProfileSectionContext,
} from './public-profile-section-types.ts';

export interface ProfileTabCountProps {
  readonly Count: PublicProfileSectionComponent;
  readonly context: PublicProfileSectionContext;
  readonly selected: boolean;
}

const PILL_CLASS_NAME =
  'rounded-full px-2 py-0.5 text-xs font-bold tabular-nums';

const reportCountFailure = (error: unknown): void => {
  if (!(error instanceof GraphQLClientError)) {
    reportUnexpectedErrorInBrowser(error, 'render');
  }
};

const renderNothing = (): null => null;

// 件数は補助の表示のため、取得中も失敗もタブの操作を妨げず、失敗した件数だけを描かない。画面には数字だけを見せ、読み上げでは数の後に単位を続ける
export function ProfileTabCount({
  Count,
  context,
  selected,
}: ProfileTabCountProps) {
  return (
    <CatchBoundary
      getResetKey={() => 0}
      onCatch={reportCountFailure}
      errorComponent={renderNothing}
    >
      <Suspense
        fallback={
          <span
            aria-hidden="true"
            className="inline-block h-5 w-7 animate-pulse rounded-full bg-accent"
          />
        }
      >
        <span
          className={cn(
            PILL_CLASS_NAME,
            selected
              ? 'bg-primary/12 text-primary'
              : 'bg-muted text-muted-foreground',
          )}
        >
          <Count {...context} />
          <span className="sr-only">{PROFILE_TAB_COUNT_UNIT}</span>
        </span>
      </Suspense>
    </CatchBoundary>
  );
}
