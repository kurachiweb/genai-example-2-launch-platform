import { useInfiniteQuery } from '@tanstack/react-query';
import { useLayoutEffect, useRef } from 'react';

import { EmptyState } from '../../../lib/components/state/empty-state.tsx';
import { PartialErrorState } from '../../../lib/components/state/partial-error-state.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { LOADING_LABEL } from '../../../lib/utilities/messages/state-messages.ts';
import { launchCommentsQueryOptions } from '../../graphql/engagement.ts';
import { CommentComposer } from './comment-composer.tsx';
import { CommentGate } from './comment-gate.tsx';
import { CommentItem } from './comment-item.tsx';
import { CommentListSkeleton } from './comment-list-skeleton.tsx';
import {
  COMMENTS_EMPTY_HINTS,
  COMMENTS_EMPTY_TITLE,
  COMMENTS_LOAD_ERROR_MESSAGE,
  COMMENTS_LOAD_MORE_LABEL,
} from './comment-messages.ts';
import {
  buildTree,
  type CommentTreeNode,
  type LaunchCommentsData,
} from './comment-tree.ts';
import type { EngagementViewerKind } from './engagement-viewer.ts';
import {
  type CommentMutations,
  useCommentMutations,
} from './use-comment-mutations.ts';
import { useEngagementViewer } from './use-engagement-viewer.ts';

export interface CommentThreadProps {
  readonly product: { readonly id: string; readonly handle: string };
  readonly launch: { readonly id: string };
  readonly viewerIsOwner: boolean;
}

interface ThreadViewProps extends CommentThreadProps {
  readonly kind: EngagementViewerKind;
  readonly viewerId: string | null;
  readonly mutations: CommentMutations | null;
}

// PartialErrorStateはボタンのrefを受けないため、枠の中の再試行のボタンを要素の目印で探す
const RETRY_BUTTON_SELECTOR = '[data-slot="partial-error-state"] button';

// 続きを読み込んだ後にフォーカスを移す先の、トップレベルの項目のまとまり
const TOP_LEVEL_ARTICLE_SELECTOR = ':scope > li > article';

// 閲覧できないプロダクト・別のプロダクトのローンチ(launchCommentsがnull)はnullにする
const toThreadTrees = (
  data: LaunchCommentsData,
): readonly CommentTreeNode[] | null =>
  data.pages[0]?.launchComments === null
    ? null
    : data.pages.flatMap(
        ({ launchComments }) => launchComments?.nodes.map(buildTree) ?? [],
      );

const ownsFocus = (area: HTMLElement | null): boolean => {
  const active = document.activeElement;
  return (
    active === null ||
    active === document.body ||
    (area !== null && area.contains(active))
  );
};

const focusRetryIn = (area: HTMLElement | null): void => {
  area?.querySelector<HTMLElement>(RETRY_BUTTON_SELECTOR)?.focus();
};

function CommentThreadView({
  product,
  launch,
  viewerIsOwner,
  kind,
  viewerId,
  mutations,
}: ThreadViewProps) {
  const query = useInfiniteQuery({
    ...launchCommentsQueryOptions(viewerId, product.id, launch.id),
    select: toThreadTrees,
  });
  const { isFetching, isFetchingNextPage, errorUpdateCount, dataUpdatedAt } =
    query;
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const moreAreaRef = useRef<HTMLDivElement>(null);
  // 続きを読み始めた時のトップレベルの件数。読み込みの後にその位置の項目へフォーカスを移す
  const focusFromRef = useRef<number | null>(null);
  const retryingFirstRef = useRef(false);
  const trees = query.data;
  const threadCount = trees?.length ?? 0;
  // 取得し直している間は前の失敗を示さず読み込み中にする
  const firstFailed = trees === undefined && !isFetching && query.isError;
  const loadMoreFailed = query.isFetchNextPageError && !isFetchingNextPage;

  // 加えた最初の項目へ、失敗なら新しい再試行のボタンへ移す。待つ間に利用者が続きの読み込みの外へ移したフォーカスは奪い返さない
  useLayoutEffect(() => {
    const from = focusFromRef.current;
    if (from === null || isFetchingNextPage) {
      return;
    }
    focusFromRef.current = null;
    if (!ownsFocus(moreAreaRef.current)) {
      return;
    }
    if (loadMoreFailed) {
      focusRetryIn(moreAreaRef.current);
      return;
    }
    const items =
      listRef.current?.querySelectorAll<HTMLElement>(
        TOP_LEVEL_ARTICLE_SELECTOR,
      ) ?? [];
    items[Math.min(from, items.length - 1)]?.focus();
  }, [isFetchingNextPage, loadMoreFailed, threadCount]);

  // 最初の取得の再試行の結果を描き直した時点で、再び失敗すれば新しい再試行のボタンへ移し、成功すれば欄に留める。応答がすぐ返ると取得中の状態を描かずに結果が描かれるため、失敗と成功の更新も見る
  useLayoutEffect(() => {
    if (!retryingFirstRef.current || isFetching) {
      return;
    }
    retryingFirstRef.current = false;
    const root = rootRef.current;
    if (firstFailed && ownsFocus(root)) {
      focusRetryIn(root);
    }
  }, [isFetching, firstFailed, errorUpdateCount, dataUpdatedAt]);

  if (trees === null) {
    return null;
  }

  const loadMore = () => {
    if (isFetchingNextPage) {
      return;
    }
    focusFromRef.current = threadCount;
    // 押した再試行のボタンは読み込みを始めると消えるため、続きの読み込みの枠へ移して待つ
    if (loadMoreFailed) {
      moreAreaRef.current?.focus();
    }
    void query.fetchNextPage();
  };

  // 押した再試行のボタンは取得を始めると消えるため、欄へフォーカスを移して待つ
  const retryFirst = () => {
    retryingFirstRef.current = true;
    rootRef.current?.focus();
    void query.refetch();
  };

  const renderList = () => {
    if (firstFailed) {
      return (
        <PartialErrorState
          message={COMMENTS_LOAD_ERROR_MESSAGE}
          onRetry={retryFirst}
        />
      );
    }
    if (trees === undefined) {
      return <CommentListSkeleton />;
    }
    if (trees.length === 0) {
      return (
        <EmptyState
          title={COMMENTS_EMPTY_TITLE}
          description={COMMENTS_EMPTY_HINTS[kind]}
          className="rounded-xl py-8"
        />
      );
    }
    return (
      <>
        <ol ref={listRef} data-slot="comment-list" className="space-y-6">
          {trees.map((node) => (
            <CommentItem
              key={node.comment.id}
              node={node}
              product={product}
              launch={launch}
              viewerIsOwner={viewerIsOwner}
              mutations={mutations}
            />
          ))}
        </ol>
        {query.hasNextPage ? (
          <div
            ref={moreAreaRef}
            tabIndex={-1}
            className="flex flex-col gap-4 rounded-md"
          >
            {isFetchingNextPage ? <CommentListSkeleton loadingMore /> : null}
            {loadMoreFailed ? (
              <PartialErrorState
                message={COMMENTS_LOAD_ERROR_MESSAGE}
                onRetry={loadMore}
              />
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full rounded-full"
                aria-disabled={isFetchingNextPage || undefined}
                aria-busy={isFetchingNextPage || undefined}
                onClick={loadMore}
              >
                {isFetchingNextPage ? LOADING_LABEL : COMMENTS_LOAD_MORE_LABEL}
              </Button>
            )}
          </div>
        ) : null}
      </>
    );
  };

  return (
    <div
      ref={rootRef}
      data-slot="comment-thread"
      tabIndex={-1}
      className="flex flex-col gap-5 rounded-md"
    >
      {mutations !== null && (kind === 'member' || kind === 'owner') ? (
        <CommentComposer
          target={{ mode: 'post', launchId: launch.id }}
          productId={product.id}
          viewerIsOwner={viewerIsOwner}
          onSubmit={mutations.post}
        />
      ) : kind === 'guest' || kind === 'unverified' ? (
        <CommentGate kind={kind} />
      ) : null}
      {renderList()}
    </div>
  );
}

// コメントの操作の呼び出しは閲覧者のIDを要するため、ログイン中の閲覧者の部品の中でだけ作る
function SignedInCommentThread(
  props: CommentThreadProps & {
    readonly kind: EngagementViewerKind;
    readonly viewerId: string;
  },
) {
  const mutations = useCommentMutations({
    productId: props.product.id,
    launchId: props.launch.id,
    viewerId: props.viewerId,
  });
  return <CommentThreadView {...props} mutations={mutations} />;
}

// ローンチのコメントの投稿欄(または投稿できない理由の案内)とスレッドの一覧。取得の失敗はこの欄の中に留める
export function CommentThread(props: CommentThreadProps) {
  const { kind, viewerId } = useEngagementViewer({
    viewer: { isOwner: props.viewerIsOwner },
  });
  return viewerId === null ? (
    <CommentThreadView
      {...props}
      kind={kind}
      viewerId={null}
      mutations={null}
    />
  ) : (
    <SignedInCommentThread {...props} kind={kind} viewerId={viewerId} />
  );
}
