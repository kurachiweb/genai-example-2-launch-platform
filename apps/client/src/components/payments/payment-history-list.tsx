import { useInfiniteQuery } from '@tanstack/react-query';
import { type RefObject, useId, useLayoutEffect, useRef } from 'react';

import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { EmptyState } from '../../../lib/components/state/empty-state.tsx';
import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { PartialErrorState } from '../../../lib/components/state/partial-error-state.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import type { AppEnvironment } from '../../../lib/utilities/system/system-status-availability.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import {
  type PaymentHistoryEntry,
  paymentHistoryQueryOptions,
  toPaymentHistoryEntries,
} from '../../graphql/payment-history.ts';
import { PaymentHistoryItem } from './payment-history-item.tsx';
import {
  LOAD_MORE_LABEL,
  LOAD_MORE_PENDING_LABEL,
  PAYMENT_HISTORY_EMPTY_MESSAGE,
  PAYMENT_HISTORY_PAGE_TITLE,
} from './payment-history-messages.ts';
import { SmokeCheckoutButton } from './smoke-checkout-button.tsx';

export interface PaymentHistoryListProps {
  readonly viewerId: string;
  readonly environment: AppEnvironment;
}

interface PaymentHistoryBodyProps {
  readonly entries: readonly PaymentHistoryEntry[] | undefined;
  readonly failure: {
    readonly message: string;
    readonly onRetry: () => void;
  } | null;
  readonly listRef: RefObject<HTMLUListElement | null>;
  readonly labelledBy: string;
}

function PaymentHistoryBody({
  entries,
  failure,
  listRef,
  labelledBy,
}: PaymentHistoryBodyProps) {
  if (failure !== null) {
    return (
      <PartialErrorState message={failure.message} onRetry={failure.onRetry} />
    );
  }
  if (entries === undefined) {
    return null;
  }
  if (entries.length === 0) {
    return <EmptyState title={PAYMENT_HISTORY_EMPTY_MESSAGE} />;
  }
  return (
    <ul
      ref={listRef}
      aria-labelledby={labelledBy}
      className="flex flex-col gap-3"
    >
      {entries.map((entry) => (
        <PaymentHistoryItem key={entry.id} entry={entry} />
      ))}
    </ul>
  );
}

// ログイン中の利用者の決済履歴を新しい順に20件ずつ示し、「さらに表示」で古い記録を後ろに加える。prod以外では末尾に疎通確認の決済の開始を置く
export function PaymentHistoryList({
  viewerId,
  environment,
}: PaymentHistoryListProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  // 続きを読み込む前の件数。読み込んだ後に、加えた最初の記録へフォーカスを移すために使う
  const focusFromRef = useRef<number | null>(null);
  const history = useInfiniteQuery({
    ...paymentHistoryQueryOptions(viewerId),
    select: toPaymentHistoryEntries,
  });
  const entries = history.data;
  // 取得し直している間は前の失敗を示さず読み込み中にする。描画中の失敗はブラウザへ渡った後に取得し直した結果で文言を選び直すためでもある
  const loadError =
    entries === undefined && !history.isFetching ? history.error : null;
  const loading = entries === undefined && loadError === null;
  const loadingMore = history.isFetchingNextPage;
  const loadMoreError =
    history.isFetchNextPageError && !loadingMore ? history.error : null;
  const entryCount = entries?.length;

  useLayoutEffect(() => {
    const from = focusFromRef.current;
    if (from === null || loadingMore) {
      return;
    }
    focusFromRef.current = null;
    // 失敗した時は「さらに表示」が残るため、フォーカスを動かさない
    if (history.isFetchNextPageError) {
      return;
    }
    // 読み込みを待つ間に利用者が「さらに表示」の外へ移したフォーカスは奪い返さない。最後のページでボタンが消えた時はフォーカスが<body>へ落ちているため移す
    const active = document.activeElement;
    if (
      active !== null &&
      active !== document.body &&
      active !== loadMoreRef.current
    ) {
      return;
    }
    const items = listRef.current?.children;
    if (items === undefined || items.length === 0) {
      return;
    }
    const target = items.item(Math.min(from, items.length - 1));
    if (target instanceof HTMLElement) {
      target.focus();
    }
  }, [entryCount, loadingMore, history.isFetchNextPageError]);

  return (
    <>
      {/* 再試行で消える再試行のボタンからフォーカスを<body>へ落とさないよう、移り先としてプログラムからだけフォーカスできるようにする */}
      <h1
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="rounded-sm text-2xl font-extrabold tracking-tight sm:text-3xl"
      >
        {PAYMENT_HISTORY_PAGE_TITLE}
      </h1>
      {/* aria-busyの中の変化は読み上げが遅れ得るため、読み込み中のLoadingSkeletonは一覧の領域のaria-busyの外に置く */}
      <div className="flex flex-col gap-4">
        {loading ? <LoadingSkeleton /> : null}
        <div aria-busy={loading ? true : undefined}>
          <PaymentHistoryBody
            entries={loadError === null ? entries : undefined}
            listRef={listRef}
            labelledBy={headingId}
            failure={
              loadError === null
                ? null
                : {
                    message: errorMessageOf(
                      loadError,
                      CLIENT_PROFILE.contactAvailable,
                    ),
                    onRetry: () => {
                      headingRef.current?.focus();
                      void history.refetch();
                    },
                  }
            }
          />
        </div>
        {entries !== undefined && history.hasNextPage ? (
          <div className="flex flex-col items-center gap-3">
            {loadMoreError === null ? null : (
              <FormMessage role="alert">
                {errorMessageOf(loadMoreError, CLIENT_PROFILE.contactAvailable)}
              </FormMessage>
            )}
            <Button
              ref={loadMoreRef}
              type="button"
              variant="outline"
              aria-disabled={loadingMore || undefined}
              aria-busy={loadingMore || undefined}
              onClick={() => {
                if (loadingMore) {
                  return;
                }
                focusFromRef.current = entries.length;
                void history.fetchNextPage();
              }}
            >
              {loadingMore ? LOAD_MORE_PENDING_LABEL : LOAD_MORE_LABEL}
            </Button>
          </div>
        ) : null}
      </div>
      {environment === 'prod' ? null : <SmokeCheckoutButton />}
    </>
  );
}
