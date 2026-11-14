import { Skeleton } from '../../../lib/components/ui/skeleton/skeleton.tsx';

const SKELETON_ITEMS = [0, 1, 2];

// 区画の中身を知らないため、一覧の項目の形(ロゴと2行の文)を3件並べて配置のずれを抑える
export function ProfileListItemSkeletons() {
  return (
    <div className="flex flex-col gap-4">
      {SKELETON_ITEMS.map((item) => (
        <div
          key={item}
          className="flex items-center gap-4 rounded-xl border border-border bg-card p-4"
        >
          <Skeleton className="size-14 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
