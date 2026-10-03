import { useEffect, useId, useState } from 'react';
import { CheckIcon, SearchIcon } from 'lucide-react';

import { Input } from '#/components/ui/input';
import { cn } from '#/lib/utils';

import type { Category } from '../-model/categories';
import { normalizeForSearch } from '../-model/text';

type Option = { slug: string | undefined; name: string };

type Props = {
  categories: Category[];
  value: string | undefined;
  onSelect: (slug: string | undefined) => void;
  autoFocus?: boolean;
  listClassName?: string;
};

// 絞り込み入力付きのリストボックス。カテゴリが数十件に増えても文字入力ですぐ目的の選択肢に届く
export function CategoryPicker({
  categories,
  value,
  onSelect,
  autoFocus,
  listClassName,
}: Props) {
  const listId = useId();
  const [filter, setFilter] = useState('');
  const keyword = normalizeForSearch(filter.trim());
  const options: Option[] = keyword
    ? categories.filter(
        (category) =>
          normalizeForSearch(category.name).includes(keyword) ||
          category.slug.includes(keyword),
      )
    : [{ slug: undefined, name: '全て' }, ...categories];
  const selectedIndex = options.findIndex((option) => option.slug === value);
  const [active, setActive] = useState(Math.max(0, selectedIndex));
  const optionId = (index: number) => `${listId}-option-${index}`;

  useEffect(() => {
    document
      .getElementById(`${listId}-option-${active}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (options.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(options.length - 1, current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(0, current - 1));
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSelect(options[active].slug);
    }
  };

  return (
    <div>
      <div className="relative">
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            options.length > 0 ? optionId(active) : undefined
          }
          aria-label="カテゴリを絞り込む"
          placeholder="カテゴリを絞り込む"
          autoFocus={autoFocus}
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
        {keyword ? `${options.length}件のカテゴリが一致します` : ''}
      </p>
      <ul
        id={listId}
        role="listbox"
        aria-label="カテゴリ"
        className={cn(
          'mt-2 max-h-72 overflow-y-auto overscroll-contain',
          listClassName,
        )}
      >
        {options.map((option, index) => {
          const selected = option.slug === value;
          return (
            <li
              key={option.slug ?? 'all'}
              id={optionId(index)}
              role="option"
              aria-selected={selected}
              data-active={index === active}
              onMouseMove={() => setActive(index)}
              onClick={() => onSelect(option.slug)}
              className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
            >
              <CheckIcon
                className={cn(
                  'mt-0.5 size-4 shrink-0 text-primary',
                  !selected && 'invisible',
                )}
                aria-hidden="true"
              />
              <span
                className={cn('min-w-0 wrap-anywhere', selected && 'font-bold')}
              >
                {option.name}
              </span>
            </li>
          );
        })}
        {options.length === 0 && (
          <li
            role="presentation"
            className="px-2 py-6 text-center text-sm text-muted-foreground"
          >
            一致するカテゴリがありません。
          </li>
        )}
      </ul>
    </div>
  );
}
