import type { Category } from '../-model/categories';
import { effectiveSort } from '../-model/query';
import type { DateRange, DirectoryQuery, SortKey } from '../-model/query';
import { CategoryFilter } from './category-filter';
import { FilterSheet } from './filter-sheet';
import type { FilterPatch } from './filter-sheet';
import { PeriodFilter } from './period-filter';
import { SearchForm } from './search-form';
import { SortFilter } from './sort-filter';

type Props = {
  query: DirectoryQuery;
  categories: Category[];
  categoriesLoading: boolean;
  onSearch: (q: string | undefined) => void;
  onCategory: (slug: string | undefined) => void;
  onPeriod: (range: DateRange) => void;
  onSort: (sort: SortKey) => void;
  onSheetApply: (patch: FilterPatch) => void;
};

// PCでは検索欄の下に絞り込み・並び順を横並びにし、モバイルではシートにまとめる。再読み込み中も操作できる状態を保つ
export function FilterToolbar({
  query,
  categories,
  categoriesLoading,
  onSearch,
  onCategory,
  onPeriod,
  onSort,
  onSheetApply,
}: Props) {
  return (
    <div className="space-y-3">
      <SearchForm value={query.q} onSearch={onSearch} />
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        <CategoryFilter
          categories={categories}
          value={query.category}
          loading={categoriesLoading}
          onChange={onCategory}
        />
        <PeriodFilter
          range={{ from: query.from, to: query.to }}
          onChange={onPeriod}
        />
        <div className="ml-auto">
          <SortFilter
            value={effectiveSort(query)}
            hasKeyword={Boolean(query.q)}
            onChange={onSort}
          />
        </div>
      </div>
      <div className="md:hidden">
        <FilterSheet
          query={query}
          categories={categories}
          loading={categoriesLoading}
          onApply={onSheetApply}
        />
      </div>
    </div>
  );
}
