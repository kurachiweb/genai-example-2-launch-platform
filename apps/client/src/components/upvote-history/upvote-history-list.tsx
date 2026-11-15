import { useSuspenseInfiniteQuery } from '@tanstack/react-query';
import { InfoIcon } from 'lucide-react';
import { useId } from 'react';

import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { EmptyState } from '../../../lib/components/state/empty-state.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import {
  type UpvoteHistoryDayView,
  toUpvoteHistoryView,
  upvoteHistoryQueryOptions,
} from '../../graphql/upvote-history.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { HOME_HREF } from '../layout/site-links.ts';
import { useFollowListFocus } from '../profile/use-follow-list-focus.ts';
import {
  formatUpvoteHistoryDate,
  upvoteHistoryDayCountLabel,
} from './upvote-history-date.ts';
import { UpvoteHistoryItem } from './upvote-history-item.tsx';
import {
  UPVOTE_HISTORY_EMPTY_OWNER_ACTION,
  UPVOTE_HISTORY_EMPTY_OWNER_DESCRIPTION,
  UPVOTE_HISTORY_EMPTY_TITLE,
  UPVOTE_HISTORY_EXCLUSION_NOTICE,
  UPVOTE_HISTORY_LOAD_MORE_ERROR,
  UPVOTE_HISTORY_LOAD_MORE_LABEL,
  UPVOTE_HISTORY_LOAD_MORE_PENDING_LABEL,
} from './upvote-history-messages.ts';

export interface UpvoteHistoryListProps {
  readonly viewer: ClientViewer | null;
  readonly handle: string;
  // 閲覧者が本人で、停止されていない(Upvoteできる)
  readonly guided: boolean;
}

// 項目は実施日の小見出しごとの一覧に分かれるため、続きを読み込んだ後のフォーカスの移り先を全ての日の項目から数える
const ITEM_SELECTOR = ':scope > section > ul > li';

function UpvoteHistoryDay({ day }: { readonly day: UpvoteHistoryDayView }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h3
        id={headingId}
        className="mb-2 flex items-baseline gap-2 border-b border-border pb-1.5 text-sm font-bold"
      >
        <time dateTime={day.date}>{formatUpvoteHistoryDate(day.date)}</time>
        <span className="text-xs font-normal text-muted-foreground">
          {upvoteHistoryDayCountLabel(day.count)}
        </span>
      </h3>
      <ul className="flex flex-col gap-2">
        {day.items.map((item) => (
          // 続きを読み込んだ後に、加えた最初の項目へフォーカスを移せるよう、プログラムからだけフォーカスできるようにする
          <li key={item.id} tabIndex={-1} className="rounded-xl">
            <UpvoteHistoryItem item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// 読み込み中と最初の取得の失敗は呼び出し側の境界が示す。マッチ実施日ごとの小見出しにまとめて新しい順に20件ずつ示し、「さらに読み込む」で続きを後ろに加える
export function UpvoteHistoryList({
  viewer,
  handle,
  guided,
}: UpvoteHistoryListProps) {
  const query = useSuspenseInfiniteQuery({
    ...upvoteHistoryQueryOptions(viewer, handle),
    select: toUpvoteHistoryView,
  });
  const view = query.data;
  const itemCount = view?.itemCount ?? 0;
  const loadingMore = query.isFetchingNextPage;
  const loadMoreFailed = query.isFetchNextPageError && !loadingMore;
  const { listRef, loadMoreRef, rememberCount } =
    useFollowListFocus<HTMLDivElement>({
      entryCount: itemCount,
      loadingMore,
      loadMoreFailed: query.isFetchNextPageError,
      itemSelector: ITEM_SELECTOR,
    });

  // 利用者を表示できない(null)時は、他人の0件と同じく事実だけを示す
  if (view === null || itemCount === 0) {
    const shownGuide = view !== null && guided;
    return (
      <EmptyState
        title={UPVOTE_HISTORY_EMPTY_TITLE}
        description={
          shownGuide ? UPVOTE_HISTORY_EMPTY_OWNER_DESCRIPTION : undefined
        }
        action={
          shownGuide ? (
            <Button asChild>
              <PathLink href={HOME_HREF}>
                {UPVOTE_HISTORY_EMPTY_OWNER_ACTION}
              </PathLink>
            </Button>
          ) : undefined
        }
      />
    );
  }

  const loadMore = () => {
    if (loadingMore) {
      return;
    }
    rememberCount(itemCount);
    void query.fetchNextPage();
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <InfoIcon aria-hidden="true" className="size-3.5 shrink-0" />
        {UPVOTE_HISTORY_EXCLUSION_NOTICE}
      </p>
      <div ref={listRef} className="flex flex-col gap-6">
        {view.days.map((day) => (
          <UpvoteHistoryDay key={day.date} day={day} />
        ))}
      </div>
      {query.hasNextPage ? (
        <div className="flex flex-col items-center gap-3">
          {loadMoreFailed && (
            <FormMessage role="alert">
              {UPVOTE_HISTORY_LOAD_MORE_ERROR}
            </FormMessage>
          )}
          <Button
            ref={loadMoreRef}
            type="button"
            variant="outline"
            aria-disabled={loadingMore || undefined}
            aria-busy={loadingMore || undefined}
            onClick={loadMore}
          >
            {loadingMore
              ? UPVOTE_HISTORY_LOAD_MORE_PENDING_LABEL
              : UPVOTE_HISTORY_LOAD_MORE_LABEL}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
