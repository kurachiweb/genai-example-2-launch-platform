import { CatchBoundary } from '@tanstack/react-router';
import { type ReactNode, Suspense } from 'react';

import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';

export interface SponsoredPlacementBoundaryProps {
  readonly children: ReactNode;
}

// GraphQLの想定外の失敗はexecuteGraphQLが送っているため送り直さない
const reportPlacementFailure = (error: unknown): void => {
  if (!(error instanceof GraphQLClientError)) {
    reportUnexpectedErrorInBrowser(error, 'render');
  }
};

const renderNothing = (): null => null;

// 広告はページの本来の内容ではないため、読み込み中も取得の失敗も枠や再試行の操作を出さずに何も描かない。
// ページの区画の境界まで失敗を伝えると失敗の表示と再試行が出るため、ここで閉じ込める
export function SponsoredPlacementBoundary({
  children,
}: SponsoredPlacementBoundaryProps) {
  return (
    <CatchBoundary
      getResetKey={() => 0}
      onCatch={reportPlacementFailure}
      errorComponent={renderNothing}
    >
      <Suspense fallback={null}>{children}</Suspense>
    </CatchBoundary>
  );
}
