import { QueryErrorResetBoundary } from '@tanstack/react-query';
import {
  CatchBoundary,
  type ErrorComponentProps,
} from '@tanstack/react-router';
import { Suspense } from 'react';

import { EmptyState } from '../../../lib/components/state/empty-state.tsx';
import { ErrorState } from '../../../lib/components/state/error-state.tsx';
import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import type { DashboardCard } from '../../composition/dashboard-cards.ts';
import { DASHBOARD_EMPTY_TITLE } from './dashboard-messages.ts';

export interface DashboardGridProps {
  readonly cards: readonly DashboardCard[];
}

const WIDTH_CLASS_NAMES: Readonly<Record<DashboardCard['width'], string>> =
  Object.freeze({
    full: 'md:col-span-2',
    half: '',
  });

// 境界が捕まえた失敗はルーターのdefaultOnCatchへ届かないため、ここで送る。GraphQLの想定外の失敗はexecuteGraphQLが送っているため送り直さない
const reportCardFailure = (error: unknown): void => {
  if (!(error instanceof GraphQLClientError)) {
    reportUnexpectedErrorInBrowser(error, 'render');
  }
};

interface CardBoundaryProps {
  readonly card: DashboardCard;
}

// 1つのカードの描画や取得の失敗をそのカードの位置に留め、他のカードの表示を続ける。再試行は取得の失敗の記録とエラーの境界の両方を解除して描き直す
function CardBoundary({ card: { component: Card } }: CardBoundaryProps) {
  return (
    <QueryErrorResetBoundary>
      {({ reset: resetQueries }) => (
        <CatchBoundary
          getResetKey={() => 0}
          onCatch={reportCardFailure}
          errorComponent={({ error, reset }: ErrorComponentProps) => (
            <ErrorState
              message={errorMessageOf(error, ADMIN_PROFILE.contactAvailable)}
              onRetry={() => {
                resetQueries();
                reset();
              }}
            />
          )}
        >
          <Suspense fallback={<LoadingSkeleton />}>
            <Card />
          </Suspense>
        </CatchBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}

export function DashboardGrid({ cards }: DashboardGridProps) {
  if (cards.length === 0) {
    return <EmptyState title={DASHBOARD_EMPTY_TITLE} />;
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {cards
        .toSorted((a, b) => a.order - b.order)
        .map((card) => (
          <div key={card.id} className={WIDTH_CLASS_NAMES[card.width]}>
            <CardBoundary card={card} />
          </div>
        ))}
    </div>
  );
}
