import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { Skeleton } from '../../../lib/components/ui/skeleton/skeleton.tsx';
import { DIRECTORY_LIST_LOADING_LABEL } from './directory-list-messages.ts';

const ITEM_KEYS = ['first', 'second', 'third', 'fourth', 'fifth'];

const PAGINATION_WIDTHS = [
  { key: 'previous', className: 'w-16' },
  { key: 'first-page', className: 'w-9' },
  { key: 'current-page', className: 'w-9' },
  { key: 'last-page', className: 'w-9' },
  { key: 'next', className: 'w-16' },
];

function ItemSkeleton() {
  return (
    <li className="grid gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_15rem] lg:grid-cols-[minmax(0,1fr)_15rem_7.5rem] lg:items-center lg:gap-5">
      <div className="flex min-w-0 items-start gap-3 sm:gap-4">
        <Skeleton
          data-skeleton="logo"
          className="size-14 shrink-0 rounded-xl sm:size-16"
        />
        <div className="min-w-0 flex-1 space-y-2.5 pt-1">
          <Skeleton data-skeleton="name" className="h-6 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <div className="flex gap-3 pt-1">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-5 w-28 rounded-full" />
          </div>
        </div>
      </div>
      <Skeleton className="h-20 w-full rounded-xl" />
      <div className="flex justify-end md:col-start-2 lg:col-start-auto">
        <Skeleton
          data-skeleton="action"
          className="h-8 w-32 rounded-full lg:w-full"
        />
      </div>
    </li>
  );
}

// 初回の読み込み中に、件数・一覧の項目(ロゴ・名称・ボタンと、一覧の項目と同じ列の配置)・ページ送りの形を保ち、読み込みの後の配置のずれを抑える
export function DirectoryListSkeleton() {
  return (
    <LoadingSkeleton
      label={DIRECTORY_LIST_LOADING_LABEL}
      aria-label={DIRECTORY_LIST_LOADING_LABEL}
    >
      <Skeleton data-skeleton="result-count" className="h-5 w-36" />
      <ul className="mt-3 flex flex-col gap-3">
        {ITEM_KEYS.map((key) => (
          <ItemSkeleton key={key} />
        ))}
      </ul>
      <div
        data-skeleton="pagination"
        className="mt-8 flex justify-center gap-1.5"
      >
        {PAGINATION_WIDTHS.map(({ key, className }) => (
          <Skeleton key={key} className={`h-8 ${className}`} />
        ))}
      </div>
    </LoadingSkeleton>
  );
}
