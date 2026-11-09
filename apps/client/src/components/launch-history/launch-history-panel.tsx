import { useQueryErrorResetBoundary } from '@tanstack/react-query';
import { CatchBoundary } from '@tanstack/react-router';
import { type RefObject, useLayoutEffect, useRef, useTransition } from 'react';

import { PartialErrorState } from '../../../lib/components/state/partial-error-state.tsx';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { ProfileTabPanelSkeleton } from '../profile/profile-tab-panel-skeleton.tsx';
import type { PublicProfileSectionContext } from '../profile/public-profile-section-types.ts';
import { LaunchHistoryList } from './launch-history-list.tsx';
import { LAUNCH_HISTORY_LOAD_ERROR } from './launch-history-messages.ts';

// 境界が捕まえた失敗はルーターのdefaultOnCatchへ届かないため、ここで送る。GraphQLの想定外の失敗は取得の補助が送っているため送り直さない
const reportLoadFailure = (error: unknown): void => {
  if (!(error instanceof GraphQLClientError)) {
    reportUnexpectedErrorInBrowser(error, 'render');
  }
};

interface LoadErrorProps {
  readonly regionRef: RefObject<HTMLDivElement | null>;
  readonly retryPendingRef: RefObject<boolean>;
  readonly onRetry: () => void;
}

// 再試行がまた失敗した時は、描き直した失敗の表示の確定と同じ時点で新しい再試行のボタンへフォーカスを移す。待つ間に利用者が区画の外へ移したフォーカスは奪い返さない
function LoadError({ regionRef, retryPendingRef, onRetry }: LoadErrorProps) {
  const stateRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!retryPendingRef.current) {
      return;
    }
    retryPendingRef.current = false;
    const active = document.activeElement;
    if (
      active !== null &&
      active !== document.body &&
      active !== regionRef.current
    ) {
      return;
    }
    stateRef.current?.querySelector('button')?.focus();
  }, [regionRef, retryPendingRef]);
  return (
    <PartialErrorState
      ref={stateRef}
      message={LAUNCH_HISTORY_LOAD_ERROR}
      onRetry={onRetry}
    />
  );
}

interface RetryLoadingProps {
  readonly regionRef: RefObject<HTMLDivElement | null>;
  readonly retryPendingRef: RefObject<boolean>;
}

// 再試行のボタンは読み込み中の表示に替わると消えるため、描き直した表示の確定と同じ時点で、取得を待つ間もパネルの位置へフォーカスを移す。利用者がパネルの外へ移したフォーカスは奪い返さない
function RetryLoading({ regionRef, retryPendingRef }: RetryLoadingProps) {
  useLayoutEffect(() => {
    const region = regionRef.current;
    if (!retryPendingRef.current || region === null) {
      return;
    }
    const active = document.activeElement;
    if (
      active !== null &&
      active !== document.body &&
      !region.contains(active)
    ) {
      retryPendingRef.current = false;
      return;
    }
    region.focus();
  }, [regionRef, retryPendingRef]);
  return <ProfileTabPanelSkeleton />;
}

// タブの枠のエラーの境界は共通の文言を示すため、最初の取得の失敗はこのパネルの境界で捕まえ、一覧の位置に本パネルの文言と再試行を示す。再試行は取得の失敗の記録と境界の両方を解除し、取得を待つ間は前の失敗の代わりに読み込み中を示す
export function LaunchHistoryPanel({ handle }: PublicProfileSectionContext) {
  const viewer = useViewer();
  const regionRef = useRef<HTMLDivElement>(null);
  const retryPendingRef = useRef(false);
  const [retrying, startRetry] = useTransition();
  const { reset: resetQueryErrors } = useQueryErrorResetBoundary();

  return (
    // 再試行のボタンは押すと消えるため、取得を待つ間と描き直した後のフォーカスの移り先にする
    <div ref={regionRef} tabIndex={-1} className="rounded-xl">
      <CatchBoundary
        getResetKey={() => 0}
        onCatch={reportLoadFailure}
        errorComponent={({ reset }) =>
          retrying ? (
            <RetryLoading
              regionRef={regionRef}
              retryPendingRef={retryPendingRef}
            />
          ) : (
            <LoadError
              regionRef={regionRef}
              retryPendingRef={retryPendingRef}
              onRetry={() => {
                retryPendingRef.current = true;
                // 表示済みの枠を読み込み中の表示へ戻さず、取得を待つ間もこのパネルを残す
                startRetry(() => {
                  resetQueryErrors();
                  reset();
                });
              }}
            />
          )
        }
      >
        <LaunchHistoryList viewer={viewer} handle={handle} />
      </CatchBoundary>
    </div>
  );
}
