import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useRef } from 'react';

import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { PartialErrorState } from '../../../lib/components/state/partial-error-state.tsx';
import { Skeleton } from '../../../lib/components/ui/skeleton/skeleton.tsx';
import {
  type MatchSupportersTarget,
  matchSupportersQueryOptions,
  toMatchSupporters,
} from '../../graphql/product-page.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { UserAvatar } from '../profile/user-avatar.tsx';
import {
  SUPPORTERS_LIST_LABEL,
  SUPPORTERS_LOAD_ERROR,
  SUPPORTERS_LOADING_MORE_LABEL,
  SUPPORTERS_NOTICE,
} from './supporters-panel-messages.ts';

export interface SupportersPanelProps extends MatchSupportersTarget {
  // 開閉のボタンのaria-controlsが指す
  readonly id: string;
  // 偽の間は取得せずに隠し、読み込んだ行は開き直す時のために残す
  readonly open: boolean;
}

const SKELETON_ROWS = [0, 1, 2, 3];

// PartialErrorStateはボタンのrefを受けないため、枠の中の再試行のボタンを要素の目印で探す
const RETRY_BUTTON_SELECTOR = '[data-slot="partial-error-state"] button';

// 枠の末尾に近づいた時点で続きを読み始め、読み込み中の行が見える間を短くする
const SENTINEL_ROOT_MARGIN = '0px 0px 80px 0px';

function SupporterRowSkeletons() {
  return (
    <div className="grid gap-1 sm:grid-cols-2">
      {SKELETON_ROWS.map((row) => (
        <div key={row} className="flex items-center gap-2 px-2 py-1.5">
          <Skeleton className="h-3 w-6" />
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <Skeleton className="h-3 w-28" />
        </div>
      ))}
    </div>
  );
}

// マッチのこのプロダクトの側のサポーターを、高さを制限した枠の中でUpvoteの早い順に20件ずつ示し、枠の末尾までスクロールすると続きを後ろに加える
export function SupportersPanel({
  id,
  open,
  productHandle,
  matchId,
  entryId,
}: SupportersPanelProps) {
  const viewer = useViewer();
  const query = useInfiniteQuery({
    ...matchSupportersQueryOptions(viewer, { productHandle, matchId, entryId }),
    select: toMatchSupporters,
    enabled: open,
  });
  const { fetchNextPage, dataUpdatedAt, errorUpdateCount, isFetching } = query;
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const retryingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const supporters = query.data ?? [];
  // 取得し直している間は前の失敗を示さず読み込み中にする
  const failed = query.isError && !query.isFetching;
  const loadingFirst = query.data === undefined && !failed;
  const loadingMore = query.isFetchingNextPage;
  // 失敗の後は利用者の再試行を待ち、スクロールで繰り返し取得しない
  const canLoadMore =
    open && query.hasNextPage && !query.isFetching && !query.isError;

  useEffect(() => {
    const root = scrollAreaRef.current;
    const target = sentinelRef.current;
    if (!canLoadMore || root === null || target === null) {
      return;
    }
    // 取得の状態が描き直されるまでに重ねて呼ぶと、読み込み中の続きのページを取り消して読み直すため、最初の交差で見るのをやめ、ページを加えるたびに見直す
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some(({ isIntersecting }) => isIntersecting)) {
          observer.disconnect();
          void fetchNextPage();
        }
      },
      { root, rootMargin: SENTINEL_ROOT_MARGIN },
    );
    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [canLoadMore, fetchNextPage, dataUpdatedAt]);

  // 押した再試行のボタンは取得を始めると消えるため、フォーカスを<body>へ落とさないよう一覧の枠へ移して待つ
  const retry = () => {
    retryingRef.current = true;
    scrollAreaRef.current?.focus();
    void (query.isFetchNextPageError ? fetchNextPage() : query.refetch());
  };

  // 再試行の結果を描き直した時点で、再び失敗すれば新しい再試行のボタンへ、行が無く枠が外れれば一覧の区画へフォーカスを移す。待つ間に利用者が枠の外へ移したフォーカスは奪わない。応答がすぐ返ると取得中の状態を描かずに結果が描かれるため、失敗と成功の更新も見る
  useLayoutEffect(() => {
    if (!retryingRef.current || isFetching) {
      return;
    }
    retryingRef.current = false;
    const area = scrollAreaRef.current;
    const active = document.activeElement;
    if (active !== null && active !== document.body && active !== area) {
      return;
    }
    if (area === null) {
      panelRef.current?.focus();
      return;
    }
    area.querySelector<HTMLElement>(RETRY_BUTTON_SELECTOR)?.focus();
  }, [isFetching, errorUpdateCount, dataUpdatedAt]);

  const shownArea =
    loadingFirst || failed || supporters.length > 0 || query.hasNextPage;

  return (
    <div
      ref={panelRef}
      id={id}
      tabIndex={-1}
      hidden={!open}
      className="border-t border-border bg-muted/40 px-3 py-3 sm:px-4"
    >
      <p className="mb-2 text-xs text-muted-foreground">{SUPPORTERS_NOTICE}</p>
      {shownArea ? (
        <div
          ref={scrollAreaRef}
          tabIndex={-1}
          aria-busy={query.isFetching || undefined}
          className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-lg border border-border bg-card p-2 text-card-foreground"
        >
          {supporters.length > 0 ? (
            <ol
              aria-label={SUPPORTERS_LIST_LABEL}
              className="grid gap-1 sm:grid-cols-2"
            >
              {supporters.map((supporter, index) => (
                <li key={supporter.handle}>
                  <Link
                    to="/@{$handle}"
                    params={{ handle: supporter.handle }}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-card-foreground no-underline hover:bg-accent hover:text-accent-foreground"
                  >
                    <span
                      aria-hidden="true"
                      className="w-6 shrink-0 text-right text-xs text-muted-foreground tabular-nums"
                    >
                      {index + 1}
                    </span>
                    <span aria-hidden="true" className="shrink-0">
                      <UserAvatar user={supporter} size={32} />
                    </span>
                    <span className="min-w-0 truncate">
                      {supporter.nickname}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : null}
          {loadingFirst || loadingMore ? (
            <LoadingSkeleton
              label={loadingMore ? SUPPORTERS_LOADING_MORE_LABEL : undefined}
            >
              <SupporterRowSkeletons />
            </LoadingSkeleton>
          ) : null}
          {failed ? (
            <PartialErrorState
              message={SUPPORTERS_LOAD_ERROR}
              onRetry={retry}
            />
          ) : null}
          <div ref={sentinelRef} aria-hidden="true" className="h-px shrink-0" />
        </div>
      ) : null}
    </div>
  );
}
