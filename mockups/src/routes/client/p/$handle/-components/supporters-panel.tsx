import { useEffect, useRef, useState } from 'react';
import { RotateCwIcon } from 'lucide-react';

import { UserAvatar } from '#/components/client/user-avatar';
import { Button } from '#/components/ui/button';
import { Skeleton } from '#/components/ui/skeleton';

import { supportersOf } from '../-model/comments';
import { usePageContext } from './page-context';

type Props = {
  id: string;
  matchId: string;
  total: number;
};

// FR-DIR-004: 20件ずつの無限スクロール
const PAGE_SIZE = 20;
const MOCK_LATENCY_MS = 600;

export function SupportersPanel({ id, matchId, total }: Props) {
  const { imagesBroken, partial } = usePageContext();
  const failing = partial === 'supporters';
  const [loaded, setLoaded] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const supporters = supportersOf(matchId, loaded);

  // 一覧の取得を模した遅延の後、次のページを表示する
  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => {
      setLoading(false);
      if (failing) {
        setFailed(true);
        return;
      }
      setLoaded((current) => Math.min(total, current + PAGE_SIZE));
    }, MOCK_LATENCY_MS);
    return () => window.clearTimeout(timer);
  }, [loading, failing, total]);

  useEffect(() => {
    const root = scroller.current;
    const target = sentinel.current;
    if (!root || !target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setLoading(true);
      },
      { root, rootMargin: '0px 0px 80px 0px' },
    );
    if (!loading && !failed && loaded < total) observer.observe(target);
    return () => observer.disconnect();
  }, [loading, failed, loaded, total]);

  return (
    <div
      id={id}
      className="border-t border-border bg-muted/40 px-3 py-3 sm:px-4"
    >
      <p className="mb-2 text-xs text-muted-foreground">
        Upvoteした日時が早い順。退会・停止したユーザーは表示されません。
      </p>
      <div
        ref={scroller}
        className="max-h-72 overflow-y-auto rounded-lg border border-border bg-card p-2"
        aria-busy={loading}
      >
        <ol className="grid gap-1 sm:grid-cols-2">
          {supporters.map((supporter, index) => (
            <li key={supporter.id}>
              <a
                href="#"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground no-underline hover:bg-accent"
              >
                <span className="scoreboard-digits w-7 text-right text-xs text-muted-foreground">
                  {index + 1}
                </span>
                <UserAvatar user={supporter} size={28} broken={imagesBroken} />
                <span className="min-w-0 wrap-anywhere">
                  {supporter.nickname}
                </span>
              </a>
            </li>
          ))}
        </ol>
        {loading && (
          <ul aria-label="読み込み中" className="grid gap-1 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="flex items-center gap-2 px-2 py-1.5">
                <Skeleton className="h-3 w-7" />
                <Skeleton className="size-7 rounded-full" />
                <Skeleton className="h-3 w-28" />
              </li>
            ))}
          </ul>
        )}
        {failed && (
          <div
            role="alert"
            className="flex flex-col items-center gap-2 px-2 py-4 text-center text-sm"
          >
            <p>サポーター一覧を読み込めませんでした。</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setFailed(false);
                setLoading(true);
              }}
            >
              <RotateCwIcon aria-hidden="true" />
              再試行
            </Button>
          </div>
        )}
        <div ref={sentinel} aria-hidden="true" className="h-px" />
      </div>
    </div>
  );
}
