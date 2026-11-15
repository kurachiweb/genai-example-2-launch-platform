import { useRef } from 'react';

import type { BusinessDateString } from '../../../common-lib/directory/directory-period.ts';
import type { DirectoryQuery } from '../../../common-lib/directory/directory-query-rules.ts';
import type { DirectoryCategoryOption } from './category-listbox.tsx';
import { CategoryPicker } from './category-picker.tsx';
import { FilterSheet } from './filter-sheet.tsx';
import type { DirectoryFilterPatch } from './filter-sheet-draft.ts';
import { PeriodFilter } from './period-filter.tsx';
import { SortSelect } from './sort-select.tsx';

export interface FilterToolbarProps {
  // URLから正規化した現在の条件
  readonly query: DirectoryQuery;
  // サーバーが並べた順(掲載数の多い順、「その他」は末尾)のまま並べる
  readonly categories: readonly DirectoryCategoryOption[];
  readonly categoriesLoading: boolean;
  // APIサーバーが返した基準時刻の今日(YYYY-MM-DD)
  readonly businessToday: BusinessDateString;
  // 横並びの選択欄は選んだ項目だけ、狭い画面のシートは「適用」で4つの項目をまとめて知らせる
  readonly onChange: (patch: DirectoryFilterPatch) => void;
}

// サーバーの描画と最初の表示を一致させるため、画面幅による出し分けはCSSのブレークポイントで行う
export function FilterToolbar({
  query,
  categories,
  categoriesLoading,
  businessToday,
  onChange,
}: FilterToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <div
        ref={toolbarRef}
        className="hidden flex-wrap items-center gap-2 md:flex"
      >
        <CategoryPicker
          categories={categories}
          loading={categoriesLoading}
          value={query.category}
          onChange={(category) => {
            onChange({ category });
          }}
        />
        <PeriodFilter
          range={{ from: query.from, to: query.to }}
          businessToday={businessToday}
          onChange={({ from, to }) => {
            onChange({ from, to });
          }}
        />
        <div className="ml-auto">
          <SortSelect
            query={query}
            onChange={(sort) => {
              onChange({ sort });
            }}
          />
        </div>
      </div>
      <div className="md:hidden">
        <FilterSheet
          query={query}
          categories={categories}
          categoriesLoading={categoriesLoading}
          businessToday={businessToday}
          onChange={onChange}
          // カテゴリの読み込み中は最初の選択欄が無効のため、押せる最初の選択欄へ移す
          onWideScreenClose={() => {
            toolbarRef.current
              ?.querySelector<HTMLButtonElement>('button:enabled')
              ?.focus();
          }}
        />
      </div>
    </>
  );
}
