import { Skeleton } from '#/components/ui/skeleton';

type Props = { count: number };

// ロゴ・名称・ボタン・ローンチ履歴の行の形を保ったスケルトン
export function ProductCardSkeletons({ count }: Props) {
  return (
    <ul className="space-y-3">
      {Array.from({ length: count }, (_, index) => (
        <li
          key={index}
          className="grid gap-4 rounded-2xl border border-border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-5"
        >
          <div className="flex items-start gap-3 sm:gap-4">
            <Skeleton className="size-14 shrink-0 rounded-xl sm:size-16" />
            <div className="flex-1 space-y-2.5 pt-1">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          </div>
          <div className="flex justify-end gap-2 sm:flex-col">
            <Skeleton className="h-8 w-32 rounded-full" />
          </div>
          <div className="space-y-2 border-t border-border/70 pt-3 sm:col-span-2">
            {[0, 1].map((row) => (
              <div key={row} className="flex items-center gap-3">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
