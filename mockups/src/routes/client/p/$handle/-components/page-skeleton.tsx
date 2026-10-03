import { Skeleton } from '#/components/ui/skeleton';

// ロゴ・名称・ボタンの形を保ったスケルトン(デザイン原則の状態表示)
export function PageSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="プロダクト情報を読み込み中"
      className="space-y-8"
    >
      <Skeleton className="h-4 w-64" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-8">
          <div className="rounded-2xl border border-border bg-card p-5 sm:p-7">
            <div className="flex items-start gap-4 sm:gap-6">
              <Skeleton className="size-20 shrink-0 rounded-2xl sm:size-32" />
              <div className="flex-1 space-y-3 pt-1">
                <Skeleton className="h-5 w-24 rounded-full" />
                <Skeleton className="h-9 w-3/4" />
                <Skeleton className="h-5 w-full" />
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
              <div className="flex items-center gap-3">
                <Skeleton className="size-10 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-4 w-28" />
                </div>
                <Skeleton className="h-8 w-24" />
              </div>
              <div className="flex gap-2">
                <Skeleton className="size-9" />
                <Skeleton className="h-10 w-36" />
              </div>
            </div>
          </div>
          <div className="flex gap-3 overflow-hidden">
            {[16, 9, 10, 16].map((ratio, i) => (
              <Skeleton
                key={i}
                className="h-52 shrink-0 rounded-xl sm:h-72"
                style={{ aspectRatio: `${ratio} / 10` }}
              />
            ))}
          </div>
          <div className="space-y-3">
            <Skeleton className="h-6 w-32" />
            {[100, 96, 88, 92, 60].map((width, i) => (
              <Skeleton
                key={i}
                className="h-4"
                style={{ width: `${width}%` }}
              />
            ))}
          </div>
          <div className="space-y-3">
            <Skeleton className="h-6 w-48" />
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="mt-3 h-12 w-24" />
            <Skeleton className="mt-4 h-7 w-40" />
          </div>
        </div>
      </div>
    </div>
  );
}
