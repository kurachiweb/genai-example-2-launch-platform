import { Skeleton } from '#/components/ui/skeleton';

const ITEMS = [0, 1, 2, 3, 4];

// 一覧項目のロゴ・名称・ボタンの形を保ったスケルトン(デザイン原則の状態表示)
export function ListSkeleton() {
  return (
    <div aria-busy="true" aria-label="プロダクト一覧を読み込み中" role="status">
      <Skeleton className="h-5 w-36" />
      <ul className="mt-4 space-y-3">
        {ITEMS.map((item) => (
          <li
            key={item}
            className="grid gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_15rem] lg:grid-cols-[minmax(0,1fr)_15rem_auto] lg:items-center lg:gap-5"
          >
            <div className="flex items-start gap-3 sm:gap-4">
              <Skeleton className="size-14 shrink-0 rounded-xl sm:size-16" />
              <div className="flex-1 space-y-2.5 pt-1">
                <Skeleton className="h-6 w-1/2" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <div className="flex gap-3 pt-1">
                  <Skeleton className="h-6 w-20 rounded-full" />
                  <Skeleton className="h-5 w-28 rounded-full" />
                  <Skeleton className="h-5 w-10 rounded-full" />
                </div>
              </div>
            </div>
            <Skeleton className="h-20 w-full rounded-xl" />
            <div className="flex justify-end md:col-start-2 lg:col-start-auto">
              <Skeleton className="h-8 w-32 rounded-full" />
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-8 flex justify-center gap-1.5">
        {[16, 9, 9, 9, 16].map((width, index) => (
          <Skeleton
            key={index}
            className="h-8"
            style={{ width: `${width * 4}px` }}
          />
        ))}
      </div>
    </div>
  );
}
