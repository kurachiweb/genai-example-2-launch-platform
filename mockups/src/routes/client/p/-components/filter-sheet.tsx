import { useId, useState } from 'react';
import { SlidersHorizontalIcon } from 'lucide-react';

import { Button } from '#/components/ui/button';
import { Label } from '#/components/ui/label';
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '#/components/ui/sheet';

import type { Category } from '../-model/categories';
import {
  PERIOD_LABELS,
  PERIOD_PRESETS,
  SORT_KEYS,
  SORT_LABELS,
  changedFilterCount,
  effectiveSort,
  periodKeyOf,
  presetRange,
} from '../-model/query';
import type {
  DateRange,
  DirectoryQuery,
  PeriodKey,
  SortKey,
} from '../-model/query';
import { CategoryPicker } from './category-picker';
import { PeriodRangeForm } from './period-range-form';

export type FilterPatch = {
  category: string | undefined;
  from: string | undefined;
  to: string | undefined;
  sort: SortKey;
};

type Draft = {
  category: string | undefined;
  period: PeriodKey;
  custom: DateRange;
  customValid: boolean;
  sort: SortKey;
};

type Props = {
  query: DirectoryQuery;
  categories: Category[];
  loading: boolean;
  onApply: (patch: FilterPatch) => void;
};

function draftOf(query: DirectoryQuery): Draft {
  const range = { from: query.from, to: query.to };
  const period = periodKeyOf(range);
  return {
    category: query.category,
    period,
    custom: period === 'custom' ? range : {},
    customValid: period === 'custom',
    sort: effectiveSort(query),
  };
}

// モバイルでは一覧を画面上部から見せるため、カテゴリ・期間・並び順を下部シートにまとめ「適用」でまとめて反映する
export function FilterSheet({ query, categories, loading, onApply }: Props) {
  const idPrefix = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(query));
  const count = changedFilterCount(query);
  const canApply = draft.period !== 'custom' || draft.customValid;

  const apply = () => {
    const range =
      draft.period === 'custom' ? draft.custom : presetRange(draft.period);
    onApply({
      category: draft.category,
      from: range.from,
      to: range.to,
      sort: draft.sort,
    });
    setOpen(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(draftOf(query));
        setOpen(next);
      }}
    >
      <SheetTrigger asChild>
        <Button variant="outline" className="h-10 rounded-xl bg-card">
          <SlidersHorizontalIcon aria-hidden="true" />
          絞り込み・並び順
          {count > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-xs leading-5 font-bold text-primary-foreground">
              <span className="sr-only">変更中の項目</span>
              {count}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[88dvh] gap-0 rounded-t-2xl">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle>絞り込み・並び順</SheetTitle>
          <SheetDescription className="sr-only">
            カテゴリ・ローンチ期間・並び順を選び、「適用」で一覧に反映します。
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4">
          <section aria-labelledby={`${idPrefix}-category`}>
            <h3 id={`${idPrefix}-category`} className="mb-2 text-sm font-bold">
              カテゴリ
            </h3>
            {loading ? (
              <p className="text-sm text-muted-foreground">読み込み中…</p>
            ) : (
              <CategoryPicker
                categories={categories}
                value={draft.category}
                onSelect={(category) =>
                  setDraft((current) => ({ ...current, category }))
                }
                listClassName="max-h-56 rounded-lg border border-border p-1"
              />
            )}
          </section>

          <section aria-labelledby={`${idPrefix}-period`}>
            <h3 id={`${idPrefix}-period`} className="mb-2 text-sm font-bold">
              期間
            </h3>
            <RadioGroup
              aria-labelledby={`${idPrefix}-period`}
              value={draft.period}
              onValueChange={(period) =>
                setDraft((current) => ({
                  ...current,
                  period: period as PeriodKey,
                }))
              }
              className="gap-1"
            >
              {[...PERIOD_PRESETS, 'custom' as const].map((key) => (
                <div key={key} className="flex items-center gap-2 py-1">
                  <RadioGroupItem
                    id={`${idPrefix}-period-${key}`}
                    value={key}
                  />
                  <Label
                    htmlFor={`${idPrefix}-period-${key}`}
                    className="text-sm font-normal"
                  >
                    {PERIOD_LABELS[key]}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            {draft.period === 'custom' && (
              <div className="mt-3 rounded-lg border border-border p-3">
                <PeriodRangeForm
                  initial={draft.custom}
                  onChange={(custom, customValid) =>
                    setDraft((current) => ({ ...current, custom, customValid }))
                  }
                />
              </div>
            )}
          </section>

          <section aria-labelledby={`${idPrefix}-sort`}>
            <h3 id={`${idPrefix}-sort`} className="mb-2 text-sm font-bold">
              並び順
            </h3>
            <RadioGroup
              aria-labelledby={`${idPrefix}-sort`}
              value={draft.sort}
              onValueChange={(sort) =>
                setDraft((current) => ({ ...current, sort: sort as SortKey }))
              }
              className="gap-1"
            >
              {SORT_KEYS.map((key) => {
                const disabled = key === 'relevance' && !query.q;
                return (
                  <div key={key} className="flex items-start gap-2 py-1">
                    <RadioGroupItem
                      id={`${idPrefix}-sort-${key}`}
                      value={key}
                      disabled={disabled}
                      className="mt-0.5"
                    />
                    <Label
                      htmlFor={`${idPrefix}-sort-${key}`}
                      className="flex-col items-start gap-0 text-sm font-normal peer-disabled:opacity-60"
                    >
                      {SORT_LABELS[key]}
                      {disabled && (
                        <span className="text-xs text-muted-foreground">
                          検索キーワードを入力すると選べます
                        </span>
                      )}
                    </Label>
                  </div>
                );
              })}
            </RadioGroup>
          </section>
        </div>

        <SheetFooter className="flex-row gap-2 border-t border-border">
          <Button
            variant="ghost"
            onClick={() =>
              setDraft({
                category: undefined,
                period: 'all',
                custom: {},
                customValid: false,
                sort: query.q ? 'relevance' : 'newest',
              })
            }
          >
            リセット
          </Button>
          <Button className="flex-1" disabled={!canApply} onClick={apply}>
            適用
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
