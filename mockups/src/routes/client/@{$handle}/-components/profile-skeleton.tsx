import { Skeleton } from '#/components/ui/skeleton';

import { ProductCardSkeletons } from './product-card-skeletons';

const SKELETON_ITEMS = 3;

// アバター・ニックネーム・フォローボタン・タブ・一覧項目の形を保ったスケルトン(デザイン原則の状態表示)
export function ProfileSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="プロフィールを読み込み中"
      className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-8 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start xl:grid-cols-[22rem_minmax(0,1fr)]"
    >
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <Skeleton className="size-20 shrink-0 rounded-full sm:size-24" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-7 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
        <Skeleton className="mt-4 h-5 w-full" />
        <Skeleton className="mt-4 h-6 w-36" />
        <div className="mt-4 flex gap-2">
          <Skeleton className="h-8 flex-1" />
          <Skeleton className="size-8" />
        </div>
        <div className="mt-5 space-y-2 border-t border-border pt-5">
          {[100, 92, 96, 60].map((width, index) => (
            <Skeleton
              key={index}
              className="h-4"
              style={{ width: `${width}%` }}
            />
          ))}
        </div>
      </div>
      <div>
        <div className="flex gap-6 border-b border-border pb-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="mt-5">
          <ProductCardSkeletons count={SKELETON_ITEMS} />
        </div>
      </div>
    </div>
  );
}
