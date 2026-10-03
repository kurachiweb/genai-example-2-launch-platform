import { RotateCwIcon } from 'lucide-react';

import { Button } from '#/components/ui/button';

import type { PagedList } from './use-paged-list';

type Props = {
  list: PagedList;
  // 読み込み中に一覧の末尾へ並べる、項目の形を保ったスケルトン
  skeleton: React.ReactNode;
};

// 一覧の末尾。読み込み中はスケルトン、失敗時は表示済みの項目を保ったまま再試行ボタンを出す
export function LoadMore({ list, skeleton }: Props) {
  return (
    <>
      {list.loading && (
        <div aria-busy="true" aria-label="続きを読み込み中" className="mt-3">
          {skeleton}
        </div>
      )}
      {list.failed && (
        <div
          role="alert"
          className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
        >
          <p className="min-w-0 flex-1">続きを読み込めませんでした。</p>
          <Button size="sm" variant="outline" onClick={list.loadMore}>
            <RotateCwIcon aria-hidden="true" />
            再試行
          </Button>
        </div>
      )}
      {!list.loading && !list.failed && list.hasMore && (
        <Button
          variant="outline"
          className="mt-4 w-full rounded-full"
          onClick={list.loadMore}
        >
          さらに読み込む
        </Button>
      )}
      <p aria-live="polite" className="sr-only">
        {`${list.total.toLocaleString()}件中${list.visible.toLocaleString()}件を表示しています。`}
      </p>
    </>
  );
}
