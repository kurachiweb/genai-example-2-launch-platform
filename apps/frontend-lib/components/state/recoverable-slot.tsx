import { QueryErrorResetBoundary } from '@tanstack/react-query';
import {
  CatchBoundary,
  type ErrorComponentProps,
} from '@tanstack/react-router';
import {
  type ReactNode,
  type RefObject,
  Suspense,
  useLayoutEffect,
  useRef,
} from 'react';

import { reportUnexpectedErrorInBrowser } from '../../start/observability/browser-error-reporting.ts';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../utilities/graphql/graphql-result.ts';
import { ErrorState } from './error-state.tsx';
import { LoadingSkeleton } from './loading-skeleton.tsx';

export interface RecoverableSlotProps {
  // 読み込み中と失敗の表示を包む。部品が自分で描く見出しを、部品が描けない間だけ補うために使う
  readonly frame?: (content: ReactNode) => ReactNode;
  readonly className?: string;
  // 問い合わせの導線を持つアプリだけが真にし、contactHrefを渡す
  readonly contactAvailable: boolean;
  readonly contactHref?: string;
  readonly children: ReactNode;
}

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';

const withoutFrame = (content: ReactNode): ReactNode => content;

// 境界が捕まえた失敗はルーターのdefaultOnCatchへ届かないため、ここで送る。GraphQLの想定外の失敗はexecuteGraphQLが送っているため送り直さない
const reportSlotFailure = (error: unknown): void => {
  if (!(error instanceof GraphQLClientError)) {
    reportUnexpectedErrorInBrowser(error, 'render');
  }
};

// 移り先の見出しや領域は登録した部品が描くため、元からフォーカスできない要素はプログラムからだけフォーカスできるようにしてから移す
const focusProgrammatically = (element: HTMLElement): void => {
  if (element.tabIndex < 0 && !element.hasAttribute('tabindex')) {
    element.setAttribute('tabindex', '-1');
  }
  element.focus();
};

// 再試行の後に描いた表示。読み込み中の後には部品か失敗の表示が続く
type RetryOutcome = 'loading' | 'failed' | 'rendered';

// 枠の要素と、再試行の後のフォーカスの移動が済んでいないことの記録
interface SlotFocus {
  readonly slotRef: RefObject<HTMLDivElement | null>;
  readonly pendingRef: RefObject<boolean>;
}

interface RetryFocusProps {
  readonly focus: SlotFocus;
  readonly outcome: RetryOutcome;
}

// 見出しが無い時の移り先。描いた部品は外側の要素(名前付きの領域など)、失敗は新しい再試行のボタン、読み込み中は位置そのもの
const FALLBACK_TARGETS: Readonly<
  Record<RetryOutcome, (slot: HTMLDivElement) => Element | null>
> = Object.freeze({
  rendered: (slot) => slot.firstElementChild,
  failed: (slot) => slot.querySelector('button'),
  loading: () => null,
});

const retryFocusTargetOf = (
  slot: HTMLDivElement,
  outcome: RetryOutcome,
): HTMLElement => {
  const heading = slot.querySelector<HTMLElement>(HEADING_SELECTOR);
  if (heading !== null) {
    return heading;
  }
  const fallback = FALLBACK_TARGETS[outcome](slot);
  return fallback instanceof HTMLElement ? fallback : slot;
};

// 再試行で消えたボタンの代わりに、描き直した表示の見出しへフォーカスを移す。描画の確定と同じ時点で移し、消えた再試行のボタンや古い失敗の表示を読み上げさせない
function RetryFocus({
  focus: { slotRef, pendingRef },
  outcome,
}: RetryFocusProps) {
  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!pendingRef.current || slot === null) {
      return;
    }
    // 取得を待つ間に利用者が枠の外へ移したフォーカスは奪い返さない
    const active = document.activeElement;
    if (active !== null && active !== document.body && !slot.contains(active)) {
      pendingRef.current = false;
      return;
    }
    focusProgrammatically(retryFocusTargetOf(slot, outcome));
    pendingRef.current = outcome === 'loading';
  }, [slotRef, pendingRef, outcome]);
  return null;
}

interface SlotLoadingProps {
  readonly frame: (content: ReactNode) => ReactNode;
  readonly focus: SlotFocus;
}

function SlotLoading({ frame, focus }: SlotLoadingProps) {
  return (
    <>
      {frame(<LoadingSkeleton />)}
      <RetryFocus focus={focus} outcome="loading" />
    </>
  );
}

interface SlotFailureProps extends ErrorComponentProps {
  readonly frame: (content: ReactNode) => ReactNode;
  readonly focus: SlotFocus;
  readonly contactAvailable: boolean;
  readonly contactHref: string | undefined;
  readonly resetQueries: () => void;
}

// 失敗の表示。再試行は取得の失敗の記録とエラーの境界の両方を解除して描き直す
function SlotFailure({
  error,
  reset,
  frame,
  focus,
  contactAvailable,
  contactHref,
  resetQueries,
}: SlotFailureProps) {
  const { pendingRef } = focus;
  return (
    <>
      {frame(
        <ErrorState
          message={errorMessageOf(error, contactAvailable)}
          contactHref={contactHref}
          onRetry={() => {
            pendingRef.current = true;
            resetQueries();
            reset();
          }}
        />,
      )}
      <RetryFocus focus={focus} outcome="failed" />
    </>
  );
}

// 1つの部品の描画や取得の失敗をその位置に留め、他の部品の表示を続ける
export function RecoverableSlot({
  frame = withoutFrame,
  className,
  contactAvailable,
  contactHref,
  children,
}: RecoverableSlotProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(false);
  const focus: SlotFocus = { slotRef, pendingRef };
  return (
    // 見出しも部品も描けない読み込み中の間のフォーカスの移り先にするため、プログラムからだけフォーカスできるようにする
    <div ref={slotRef} tabIndex={-1} className={className}>
      <QueryErrorResetBoundary>
        {({ reset: resetQueries }) => (
          <CatchBoundary
            getResetKey={() => 0}
            onCatch={reportSlotFailure}
            errorComponent={(props: ErrorComponentProps) => (
              <SlotFailure
                {...props}
                frame={frame}
                focus={focus}
                contactAvailable={contactAvailable}
                contactHref={contactHref}
                resetQueries={resetQueries}
              />
            )}
          >
            <Suspense fallback={<SlotLoading frame={frame} focus={focus} />}>
              {children}
              <RetryFocus focus={focus} outcome="rendered" />
            </Suspense>
          </CatchBoundary>
        )}
      </QueryErrorResetBoundary>
    </div>
  );
}
