import { useEffect, useId, useState } from 'react';
import { ChevronDownIcon, MessageCircleIcon, RotateCwIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '#/components/ui/button';
import { Skeleton } from '#/components/ui/skeleton';
import { cn } from '#/lib/utils';

import type { CommentNode } from '../-model/comments';
import { CommentComposer } from './comment-composer';
import { CommentGate } from './comment-gate';
import { CommentItem } from './comment-item';
import type { CommentActions } from './comment-item';
import {
  appendReply,
  countComments,
  editBody,
  markDeleted,
} from './comment-tree';
import { usePageContext } from './page-context';

type Props = {
  launchNumber: number;
  initial: CommentNode[];
  defaultOpen: boolean;
};

// トップレベルのコメントはページ毎に10件(FR-COMNT-004)
const PAGE_SIZE = 10;
const MOCK_LATENCY_MS = 700;

export function CommentThread({ launchNumber, initial, defaultOpen }: Props) {
  const { role, viewer, now, partial, myRating, setMyRating } =
    usePageContext();
  const contentId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [items, setItems] = useState(initial);
  const [visible, setVisible] = useState(Math.min(PAGE_SIZE, initial.length));
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const total = countComments(items);
  const canPost = role === 'user' || role === 'owner';

  // 追加読み込みの通信を模した遅延
  useEffect(() => {
    if (!loadingMore) return;
    const timer = window.setTimeout(() => {
      setLoadingMore(false);
      if (partial === 'comments') {
        setLoadFailed(true);
        return;
      }
      setVisible((current) => Math.min(items.length, current + PAGE_SIZE));
    }, MOCK_LATENCY_MS);
    return () => window.clearTimeout(timer);
  }, [loadingMore, partial, items.length]);

  const newNode = (body: string): CommentNode => ({
    id: `new-${Date.now()}`,
    author: viewer,
    body,
    createdAt: now,
    edited: false,
    isOwn: true,
    isMaker: role === 'owner',
    replies: [],
  });

  const actions: CommentActions = {
    reply: (parentId, body) => {
      setItems((current) => appendReply(current, parentId, newNode(body)));
      toast.success('返信しました。');
    },
    edit: (id, body) => {
      setItems((current) => editBody(current, id, body));
      toast.success('コメントを更新しました。');
    },
    remove: (id) => {
      setItems((current) => markDeleted(current, id));
      toast.success('コメントを削除しました。');
    },
  };

  const post = (body: string, rating: number | null) => {
    setItems((current) => [newNode(body), ...current]);
    setVisible((current) => current + 1);
    if (rating !== null) setMyRating(rating);
    toast.success(
      rating ? 'コメントと評価を投稿しました。' : 'コメントしました。',
    );
  };

  return (
    <section
      aria-label={`第${launchNumber}回ローンチへのコメント`}
      className="mt-5"
    >
      <Button
        variant="ghost"
        className="-ml-3 text-base font-extrabold"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((current) => !current)}
      >
        <MessageCircleIcon aria-hidden="true" className="text-primary" />
        コメント
        <span className="scoreboard-digits text-sm text-muted-foreground">
          {total}件
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className={cn('transition-transform', open && 'rotate-180')}
        />
      </Button>

      {open && (
        <div id={contentId} className="mt-3 space-y-5">
          {canPost ? (
            <CommentComposer
              submitLabel="コメントする"
              placeholder="このローンチへのコメントを書く(マークダウン対応)"
              onSubmit={post}
              rating={role === 'user' ? { value: myRating } : undefined}
            />
          ) : (
            <CommentGate />
          )}

          {items.length === 0 ? (
            <EmptyComments />
          ) : (
            <ol className="space-y-6">
              {items.slice(0, visible).map((node) => (
                <CommentItem
                  key={node.id}
                  node={node}
                  depth={1}
                  actions={actions}
                />
              ))}
            </ol>
          )}

          {loadingMore && (
            <ul aria-label="読み込み中" className="space-y-4">
              {[0, 1].map((i) => (
                <li key={i} className="flex gap-3">
                  <Skeleton className="size-9 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </li>
              ))}
            </ul>
          )}

          {loadFailed && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
            >
              <p className="min-w-0 flex-1">コメントを読み込めませんでした。</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setLoadFailed(false);
                  setLoadingMore(true);
                }}
              >
                <RotateCwIcon aria-hidden="true" />
                再試行
              </Button>
            </div>
          )}

          {!loadingMore && !loadFailed && visible < items.length && (
            <Button
              variant="outline"
              className="w-full rounded-full"
              onClick={() => setLoadingMore(true)}
            >
              さらに読み込む
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function EmptyComments() {
  const { role } = usePageContext();
  const hint =
    role === 'owner'
      ? 'ローンチの背景や近況を書いて、サポーターに伝えましょう。'
      : role === 'user'
        ? '感想や質問を最初に書いてみましょう。'
        : role === 'unverified'
          ? 'メールアドレスを確認すると、最初のコメントを書けます。'
          : 'ログインすると、最初のコメントを書けます。';
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
      <MessageCircleIcon
        className="mx-auto size-8 text-muted-foreground/60"
        aria-hidden="true"
      />
      <p className="mt-2 font-semibold">まだコメントはありません。</p>
      <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}
