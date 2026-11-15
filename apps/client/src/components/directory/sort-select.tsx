import { useId } from 'react';

import {
  DIRECTORY_SORTS,
  type DirectoryQuery,
  type DirectorySort,
  effectiveSort,
} from '../../../common-lib/directory/directory-query-rules.ts';
import { DropdownMenu } from '../../../lib/components/ui/dropdown-menu/dropdown-menu.tsx';
import { DropdownMenuContent } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-content.tsx';
import { DropdownMenuRadioGroup } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-radio-group.tsx';
import { DropdownMenuRadioItem } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-radio-item.tsx';
import { DropdownMenuTrigger } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-trigger.tsx';
import { FilterTrigger } from './filter-trigger.tsx';
import {
  RELEVANCE_UNAVAILABLE_REASON,
  SORT_LABELS,
  SORT_SELECT_LABEL,
} from './sort-select-messages.ts';

export interface SortSelectProps {
  // URLから正規化した現在の条件
  readonly query: DirectoryQuery;
  readonly onChange: (sort: DirectorySort) => void;
}

const sortOf = (value: string): DirectorySort | undefined =>
  DIRECTORY_SORTS.find((sort) => sort === value);

export function SortSelect({ query, onChange }: SortSelectProps) {
  const id = useId();
  const selected = effectiveSort(query);
  const relevanceAvailable = query.q !== undefined;
  const reasonId = `${id}-relevance-reason`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <FilterTrigger
          label={SORT_SELECT_LABEL}
          value={SORT_LABELS[selected]}
          active={query.sort !== undefined}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuRadioGroup
          value={selected}
          onValueChange={(value) => {
            const next = sortOf(value);
            if (next !== undefined && next !== selected) {
              onChange(next);
            }
          }}
        >
          {DIRECTORY_SORTS.map((sort) => {
            const disabled = sort === 'relevance' && !relevanceAvailable;
            const labelId = `${id}-${sort}`;
            return (
              <DropdownMenuRadioItem
                key={sort}
                value={sort}
                disabled={disabled}
                aria-labelledby={labelId}
                aria-describedby={disabled ? reasonId : undefined}
                // 選べない理由を読めるよう、無効の項目を半透明にせず文字の色で示す
                className="data-disabled:opacity-100"
              >
                <span className="flex flex-col">
                  <span
                    id={labelId}
                    className={disabled ? 'text-muted-foreground' : undefined}
                  >
                    {SORT_LABELS[sort]}
                  </span>
                  {disabled ? (
                    <span
                      id={reasonId}
                      className="text-xs text-muted-foreground"
                    >
                      {RELEVANCE_UNAVAILABLE_REASON}
                    </span>
                  ) : null}
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
