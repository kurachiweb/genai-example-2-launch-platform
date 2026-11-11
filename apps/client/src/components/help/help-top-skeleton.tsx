import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { Skeleton } from '../../../lib/components/ui/skeleton/skeleton.tsx';
import { HELP_TOP_LOADING_LABEL } from './help-messages.ts';

const CATEGORY_KEYS = ['first', 'second'];

const ITEM_KEYS = ['first', 'second', 'third', 'fourth'];

// カテゴリの見出しと項目(タイトルとサブタイトル)の形を保ち、読み込みの後の配置のずれを抑える
export function HelpTopSkeleton() {
  return (
    <LoadingSkeleton label={HELP_TOP_LOADING_LABEL}>
      <div className="flex flex-col gap-8">
        {CATEGORY_KEYS.map((category) => (
          <div key={category} className="flex flex-col gap-3">
            <Skeleton className="h-7 w-40" />
            <div className="grid gap-2 md:grid-cols-2">
              {ITEM_KEYS.map((item) => (
                <Skeleton key={item} className="h-[4.5rem] rounded-xl" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </LoadingSkeleton>
  );
}
