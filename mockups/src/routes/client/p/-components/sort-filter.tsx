import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';

import { SORT_KEYS, SORT_LABELS } from '../-model/query';
import type { SortKey } from '../-model/query';
import { FilterTrigger } from './filter-trigger';

type Props = {
  value: SortKey;
  hasKeyword: boolean;
  onChange: (sort: SortKey) => void;
};

export function SortFilter({ value, hasKeyword, onChange }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <FilterTrigger
          label="並び順"
          value={SORT_LABELS[value]}
          active={false}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as SortKey)}
        >
          {SORT_KEYS.map((key) => {
            // 関連度は検索語がある場合のみ選べる
            const disabled = key === 'relevance' && !hasKeyword;
            return (
              <DropdownMenuRadioItem key={key} value={key} disabled={disabled}>
                <span className="flex flex-col">
                  {SORT_LABELS[key]}
                  {disabled && (
                    <span className="text-xs text-muted-foreground">
                      検索キーワードを入力すると選べます
                    </span>
                  )}
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
