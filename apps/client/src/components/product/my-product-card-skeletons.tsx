import { Skeleton } from '../../../lib/components/ui/skeleton/skeleton.tsx';

const SKELETON_CARDS = [0, 1, 2];

// 読み込んだ後のカードと同じ配置(ロゴ・名称と状態・操作)を保ち、表示が切り替わる時のずれを抑える
export function MyProductCardSkeletons() {
  return (
    <div className="flex flex-col gap-4">
      {SKELETON_CARDS.map((card) => (
        <div
          key={card}
          className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-start sm:p-5"
        >
          <Skeleton className="size-16 shrink-0 rounded-lg" />
          <div className="flex flex-1 flex-col gap-3">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
          <Skeleton className="h-8 w-20 shrink-0" />
        </div>
      ))}
    </div>
  );
}
