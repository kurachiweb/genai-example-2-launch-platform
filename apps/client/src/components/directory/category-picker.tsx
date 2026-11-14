import { useState } from 'react';

import { Popover } from '../../../lib/components/ui/popover/popover.tsx';
import { PopoverContent } from '../../../lib/components/ui/popover/popover-content.tsx';
import { PopoverTrigger } from '../../../lib/components/ui/popover/popover-trigger.tsx';
import {
  CategoryListbox,
  type DirectoryCategoryOption,
} from './category-listbox.tsx';
import {
  CATEGORY_ALL_LABEL,
  CATEGORY_LOADING_VALUE,
  CATEGORY_PICKER_LABEL,
} from './category-picker-messages.ts';
import { FilterTrigger } from './filter-trigger.tsx';

export interface CategoryPickerProps {
  // サーバーが並べた順(掲載数の多い順、「その他」は末尾)のまま並べる
  readonly categories: readonly DirectoryCategoryOption[];
  readonly loading: boolean;
  // 適用中のカテゴリのハンドル(保存済みの小文字)。「全て」はundefined
  readonly value: string | undefined;
  readonly onChange: (handle: string | undefined) => void;
}

export function CategoryPicker({
  categories,
  loading,
  value,
  onChange,
}: CategoryPickerProps) {
  const [open, setOpen] = useState(false);
  const selected = categories.find((category) => category.handle === value);
  const displayValue = loading
    ? CATEGORY_LOADING_VALUE
    : (selected?.name ?? CATEGORY_ALL_LABEL);

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FilterTrigger
          label={CATEGORY_PICKER_LABEL}
          value={displayValue}
          disabled={loading}
          active={!loading && selected !== undefined}
          className="max-w-72"
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={CATEGORY_PICKER_LABEL}
        className="w-80 p-2"
      >
        <CategoryListbox
          categories={categories}
          value={selected?.handle}
          onSelect={(handle) => {
            setOpen(false);
            if (handle !== selected?.handle) {
              onChange(handle);
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
