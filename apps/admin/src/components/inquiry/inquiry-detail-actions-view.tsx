import { QueryErrorResetBoundary } from '@tanstack/react-query';
import {
  CatchBoundary,
  type ErrorComponentProps,
} from '@tanstack/react-router';
import { Suspense } from 'react';

import { ErrorState } from '../../../lib/components/state/error-state.tsx';
import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import type {
  InquiryDetailAction,
  InquiryDetailActionContext,
} from '../../composition/inquiry-detail-actions.ts';

export interface InquiryDetailActionsViewProps {
  readonly actions: readonly InquiryDetailAction[];
  readonly inquiry: InquiryDetailActionContext;
}

// 境界が捕まえた失敗はルーターのdefaultOnCatchへ届かないため、ここで送る。GraphQLの想定外の失敗はexecuteGraphQLが送っているため送り直さない
const reportActionFailure = (error: unknown): void => {
  if (!(error instanceof GraphQLClientError)) {
    reportUnexpectedErrorInBrowser(error, 'render');
  }
};

// 1つの操作の描画や取得の失敗をその操作の位置に留め、詳細と他の操作の表示を続ける。再試行は取得の失敗の記録とエラーの境界の両方を解除して描き直す
function ActionBoundary({
  action: { component: Action },
  inquiry,
}: {
  readonly action: InquiryDetailAction;
  readonly inquiry: InquiryDetailActionContext;
}) {
  return (
    <QueryErrorResetBoundary>
      {({ reset: resetQueries }) => (
        <CatchBoundary
          getResetKey={() => 0}
          onCatch={reportActionFailure}
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
            <Action inquiry={inquiry} />
          </Suspense>
        </CatchBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}

// 後続specが登録した操作を順序どおりに並べる。登録が無ければ見出しや空状態も含めて何も描かない
export function InquiryDetailActionsView({
  actions,
  inquiry,
}: InquiryDetailActionsViewProps) {
  if (actions.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-4">
      {actions
        .toSorted((a, b) => a.order - b.order)
        .map((action) => (
          <ActionBoundary key={action.id} action={action} inquiry={inquiry} />
        ))}
    </div>
  );
}
