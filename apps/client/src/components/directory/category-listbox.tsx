import { CheckIcon, SearchIcon } from 'lucide-react';
import { type KeyboardEvent, useEffect, useId, useState } from 'react';

import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import type { ClientDirectoryCategoriesQuery } from '../../graphql/generated/graphql.ts';
import {
  CATEGORY_ALL_LABEL,
  CATEGORY_FILTER_LABEL,
  CATEGORY_NO_MATCH_MESSAGE,
  CATEGORY_PICKER_LABEL,
  categoryMatchCountText,
} from './category-picker-messages.ts';

export type DirectoryCategoryOption =
  ClientDirectoryCategoriesQuery['directoryCategories'][number];

export interface CategoryListboxProps {
  // サーバーが並べた順(掲載数の多い順、「その他」は末尾)のまま並べる
  readonly categories: readonly DirectoryCategoryOption[];
  // 選択中のカテゴリのハンドル。「全て」はundefined
  readonly value: string | undefined;
  readonly onSelect: (handle: string | undefined) => void;
  readonly listClassName?: string;
}

interface ListOption {
  readonly handle: string | undefined;
  readonly name: string;
}

const normalizeForFilter = (text: string): string =>
  trimWhiteSpace(text).normalize('NFKC').toLowerCase();

const optionsOf = (
  categories: readonly DirectoryCategoryOption[],
  keyword: string,
): readonly ListOption[] =>
  keyword === ''
    ? [{ handle: undefined, name: CATEGORY_ALL_LABEL }, ...categories]
    : categories.filter(
        (category) =>
          normalizeForFilter(category.name).includes(keyword) ||
          category.handle.toLowerCase().includes(keyword),
      );

// 入力欄にフォーカスを置いたまま、選択の候補をaria-activedescendantで伝えるコンボボックス
export function CategoryListbox({
  categories,
  value,
  onSelect,
  listClassName,
}: CategoryListboxProps) {
  const listId = useId();
  const [filter, setFilter] = useState('');
  const keyword = normalizeForFilter(filter);
  const options = optionsOf(categories, keyword);
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.handle === value),
    ),
  );
  const activeIndex = Math.min(active, options.length - 1);
  const optionId = (index: number) => `${listId}-option-${String(index)}`;
  const activeId = activeIndex >= 0 ? optionId(activeIndex) : undefined;
  const expanded = options.length > 0;

  useEffect(() => {
    if (activeId !== undefined) {
      document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeId]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(Math.min(options.length - 1, activeIndex + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(Math.max(0, activeIndex - 1));
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const selected = options[activeIndex];
      if (selected !== undefined) {
        onSelect(selected.handle);
      }
    }
  };

  return (
    <div>
      <div className="relative">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          role="combobox"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-label={CATEGORY_FILTER_LABEL}
          placeholder={CATEGORY_FILTER_LABEL}
          autoComplete="off"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="pl-8"
        />
      </div>
      <p className="sr-only" aria-live="polite">
        {keyword === '' ? '' : categoryMatchCountText(options.length)}
      </p>
      {expanded ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={CATEGORY_PICKER_LABEL}
          className={cn(
            'mt-2 max-h-72 overflow-y-auto overscroll-contain',
            listClassName,
          )}
        >
          {options.map((option, index) => {
            const selected = option.handle === value;
            return (
              // eslint-disable-next-line jsx-a11y-x/click-events-have-key-events -- 選択の候補は入力欄のキー操作で移すため、選択肢はフォーカスを受けず、押下で入力欄のフォーカスを奪わない
              <li
                key={option.handle ?? ''}
                id={optionId(index)}
                role="option"
                aria-selected={selected}
                data-active={index === activeIndex}
                onPointerMove={() => {
                  setActive(index);
                }}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  onSelect(option.handle);
                }}
                className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
              >
                <CheckIcon
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 size-4 shrink-0 text-primary',
                    !selected && 'invisible',
                  )}
                />
                <span
                  className={cn(
                    'min-w-0 wrap-anywhere',
                    selected && 'font-bold',
                  )}
                >
                  {option.name}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        // 選択肢の無いリストボックスは支援技術へ正しく伝わらないため、一致が無い間は一覧を描かずに文言だけを示す
        <p
          className={cn(
            'mt-2 px-2 py-6 text-center text-sm text-muted-foreground',
            listClassName,
          )}
        >
          {CATEGORY_NO_MATCH_MESSAGE}
        </p>
      )}
    </div>
  );
}
