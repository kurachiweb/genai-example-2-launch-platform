import { useState } from 'react';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover';

import { findCategory } from '../-model/categories';
import type { Category } from '../-model/categories';
import { CategoryPicker } from './category-picker';
import { FilterTrigger } from './filter-trigger';

type Props = {
  categories: Category[];
  value: string | undefined;
  // カテゴリのマスタを取得中(初回ローディング)
  loading: boolean;
  onChange: (slug: string | undefined) => void;
};

export function CategoryFilter({
  categories,
  value,
  loading,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const selected = findCategory(categories, value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FilterTrigger
          label="カテゴリ"
          value={loading ? '読み込み中…' : (selected?.name ?? '全て')}
          active={Boolean(selected)}
          disabled={loading}
          className="max-w-72"
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <CategoryPicker
          autoFocus
          categories={categories}
          value={value}
          onSelect={(slug) => {
            setOpen(false);
            if (slug !== value) onChange(slug);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
