import { cn } from '#/lib/utils';

import type { DirectoryEntry } from '../-model/listing';
import { Pagination } from './pagination';
import { ProductItem } from './product-item';
import { useDirectoryFormat } from './use-directory-format';

type Props = {
  total: number;
  page: number;
  pageCount: number;
  first: number;
  last: number;
  entries: DirectoryEntry[];
  query: string | undefined;
  imagesBroken: boolean;
  // 条件変更後の再読み込み中は直前の結果を薄く残し、操作を止める
  refetching: boolean;
  onNavigate: () => void;
};

export function ResultList({
  total,
  page,
  pageCount,
  first,
  last,
  entries,
  query,
  imagesBroken,
  refetching,
  onNavigate,
}: Props) {
  const format = useDirectoryFormat();
  const summary =
    pageCount === 1
      ? `${format.number(total)}件`
      : `${format.number(total)}件中${format.number(first)}〜${format.number(last)}件`;

  return (
    <div aria-busy={refetching} className="relative">
      <p
        aria-live="polite"
        className="text-sm font-semibold text-muted-foreground"
      >
        {refetching ? '読み込み中…' : summary}
      </p>
      <div className="relative mt-3">
        {refetching && (
          <div
            aria-hidden="true"
            className="absolute inset-x-0 -top-2 h-1 overflow-hidden rounded-full bg-primary/15"
          >
            <div className="progress-indeterminate h-full w-2/5 rounded-full bg-primary" />
          </div>
        )}
        <div
          inert={refetching}
          className={cn(
            'transition-opacity duration-200',
            refetching && 'opacity-45 saturate-50',
          )}
        >
          <ul className="space-y-3">
            {entries.map((entry) => (
              <ProductItem
                key={entry.id}
                entry={entry}
                query={query}
                imagesBroken={imagesBroken}
              />
            ))}
          </ul>
          <Pagination
            page={page}
            pageCount={pageCount}
            onNavigate={onNavigate}
          />
        </div>
      </div>
    </div>
  );
}
