import { SlidersHorizontalIcon } from 'lucide-react';
import { useId, useState } from 'react';

import {
  type BusinessDateString,
  PERIOD_PRESETS,
  type PeriodPreset,
} from '../../../common-lib/directory/directory-period.ts';
import {
  changedConditionCount,
  DIRECTORY_SORTS,
  type DirectoryQuery,
  type DirectorySort,
  effectiveSort,
} from '../../../common-lib/directory/directory-query-rules.ts';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Label } from '../../../lib/components/ui/label/label.tsx';
import { RadioGroup } from '../../../lib/components/ui/radio-group/radio-group.tsx';
import { RadioGroupItem } from '../../../lib/components/ui/radio-group/radio-group-item.tsx';
import { Sheet } from '../../../lib/components/ui/sheet/sheet.tsx';
import { SheetContent } from '../../../lib/components/ui/sheet/sheet-content.tsx';
import { SheetDescription } from '../../../lib/components/ui/sheet/sheet-description.tsx';
import { SheetFooter } from '../../../lib/components/ui/sheet/sheet-footer.tsx';
import { SheetHeader } from '../../../lib/components/ui/sheet/sheet-header.tsx';
import { SheetTitle } from '../../../lib/components/ui/sheet/sheet-title.tsx';
import { SheetTrigger } from '../../../lib/components/ui/sheet/sheet-trigger.tsx';
import {
  CategoryListbox,
  type DirectoryCategoryOption,
} from './category-listbox.tsx';
import {
  CATEGORY_LOADING_VALUE,
  CATEGORY_PICKER_LABEL,
} from './category-picker-messages.ts';
import {
  type DirectoryFilterPatch,
  filterPatchOfDraft,
  filterSheetDraftOf,
  isApplicableFilterSheetDraft,
  resetFilterSheetDraft,
} from './filter-sheet-draft.ts';
import {
  CHANGED_CONDITION_COUNT_LABEL,
  FILTER_SHEET_APPLY_LABEL,
  FILTER_SHEET_DESCRIPTION,
  FILTER_SHEET_LABEL,
  FILTER_SHEET_RESET_LABEL,
} from './filter-sheet-messages.ts';
import {
  PERIOD_FILTER_LABEL,
  PERIOD_OPTION_LABELS,
} from './period-filter-messages.ts';
import { PeriodRangeForm } from './period-range-form.tsx';
import {
  RELEVANCE_UNAVAILABLE_REASON,
  SORT_LABELS,
  SORT_SELECT_LABEL,
} from './sort-select-messages.ts';

export interface FilterSheetProps {
  // URLから正規化した現在の条件
  readonly query: DirectoryQuery;
  // サーバーが並べた順(掲載数の多い順、「その他」は末尾)のまま並べる
  readonly categories: readonly DirectoryCategoryOption[];
  readonly categoriesLoading: boolean;
  // APIサーバーが返した基準時刻の今日(YYYY-MM-DD)
  readonly businessToday: BusinessDateString;
  // 「適用」の時だけ、カテゴリ・期間の両端・並び順の4つの項目を必ず持たせて知らせる
  readonly onChange: (patch: DirectoryFilterPatch) => void;
}

const PERIOD_KEYS: readonly (PeriodPreset | 'custom')[] = [
  ...PERIOD_PRESETS,
  'custom',
];

const periodKeyOfValue = (value: string): PeriodPreset | 'custom' | undefined =>
  PERIOD_KEYS.find((key) => key === value);

const sortOfValue = (value: string): DirectorySort | undefined =>
  DIRECTORY_SORTS.find((sort) => sort === value);

const isUnchanged = (
  patch: DirectoryFilterPatch,
  query: DirectoryQuery,
): boolean =>
  patch.category === query.category &&
  patch.from === query.from &&
  patch.to === query.to &&
  patch.sort === effectiveSort(query);

// 狭い画面では一覧を画面の上から見せるため、カテゴリ・期間・並び順を下部のシートにまとめ、選んだ条件を下書きとして持って「適用」でまとめて知らせる
export function FilterSheet({
  query,
  categories,
  categoriesLoading,
  businessToday,
  onChange,
}: FilterSheetProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() =>
    filterSheetDraftOf(query, businessToday),
  );
  const count = changedConditionCount(query);
  const relevanceAvailable = query.q !== undefined;
  const headingIdOf = (section: string) => `${id}-${section}-heading`;
  const relevanceReasonId = `${id}-relevance-reason`;

  const apply = () => {
    const patch = filterPatchOfDraft(draft, businessToday);
    setOpen(false);
    if (!isUnchanged(patch, query)) {
      onChange(patch);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraft(filterSheetDraftOf(query, businessToday));
        }
        setOpen(next);
      }}
    >
      <SheetTrigger asChild>
        <Button variant="outline" className="h-10 rounded-xl bg-card">
          <SlidersHorizontalIcon aria-hidden="true" />
          {FILTER_SHEET_LABEL}
          {count > 0 ? (
            <>
              {' '}
              <span className="rounded-full bg-primary px-1.5 text-xs leading-5 font-bold text-primary-foreground">
                <span className="sr-only">
                  {CHANGED_CONDITION_COUNT_LABEL}{' '}
                </span>
                {count}
              </span>
            </>
          ) : null}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[88dvh] gap-0 rounded-t-2xl">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle>{FILTER_SHEET_LABEL}</SheetTitle>
          <SheetDescription className="sr-only">
            {FILTER_SHEET_DESCRIPTION}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-4">
          <section aria-labelledby={headingIdOf('category')}>
            <h3 id={headingIdOf('category')} className="mb-2 text-sm font-bold">
              {CATEGORY_PICKER_LABEL}
            </h3>
            {categoriesLoading ? (
              <p className="text-sm text-muted-foreground">
                {CATEGORY_LOADING_VALUE}
              </p>
            ) : (
              <CategoryListbox
                categories={categories}
                value={draft.category}
                onSelect={(category) => {
                  setDraft((current) => ({ ...current, category }));
                }}
                listClassName="max-h-56 rounded-lg border border-border p-1"
              />
            )}
          </section>

          <section aria-labelledby={headingIdOf('period')}>
            <h3 id={headingIdOf('period')} className="mb-2 text-sm font-bold">
              {PERIOD_FILTER_LABEL}
            </h3>
            <RadioGroup
              aria-labelledby={headingIdOf('period')}
              value={draft.period}
              onValueChange={(value) => {
                const period = periodKeyOfValue(value);
                if (period !== undefined) {
                  setDraft((current) => ({ ...current, period }));
                }
              }}
              className="gap-1"
            >
              {PERIOD_KEYS.map((key) => {
                const itemId = `${id}-period-${key}`;
                return (
                  <div key={key} className="flex items-center gap-2 py-1">
                    <RadioGroupItem id={itemId} value={key} />
                    <Label htmlFor={itemId} className="font-normal">
                      {PERIOD_OPTION_LABELS[key]}
                    </Label>
                  </div>
                );
              })}
            </RadioGroup>
            {draft.period === 'custom' ? (
              <div className="mt-3 rounded-lg border border-border p-3">
                <PeriodRangeForm
                  value={draft.custom}
                  businessToday={businessToday}
                  onChange={(custom) => {
                    setDraft((current) => ({ ...current, custom }));
                  }}
                />
              </div>
            ) : null}
          </section>

          <section aria-labelledby={headingIdOf('sort')}>
            <h3 id={headingIdOf('sort')} className="mb-2 text-sm font-bold">
              {SORT_SELECT_LABEL}
            </h3>
            <RadioGroup
              aria-labelledby={headingIdOf('sort')}
              value={draft.sort}
              onValueChange={(value) => {
                const sort = sortOfValue(value);
                if (sort !== undefined) {
                  setDraft((current) => ({ ...current, sort }));
                }
              }}
              className="gap-1"
            >
              {DIRECTORY_SORTS.map((sort) => {
                const disabled = sort === 'relevance' && !relevanceAvailable;
                const itemId = `${id}-sort-${sort}`;
                const labelId = `${itemId}-label`;
                return (
                  <div key={sort} className="flex items-start gap-2 py-1">
                    <RadioGroupItem
                      id={itemId}
                      value={sort}
                      disabled={disabled}
                      aria-labelledby={labelId}
                      aria-describedby={
                        disabled ? relevanceReasonId : undefined
                      }
                      className="mt-0.5"
                    />
                    <Label
                      htmlFor={itemId}
                      className="flex-col items-start gap-0 font-normal"
                    >
                      <span
                        id={labelId}
                        className={
                          disabled ? 'text-muted-foreground' : undefined
                        }
                      >
                        {SORT_LABELS[sort]}
                      </span>
                      {disabled ? (
                        <span
                          id={relevanceReasonId}
                          className="text-xs text-muted-foreground"
                        >
                          {RELEVANCE_UNAVAILABLE_REASON}
                        </span>
                      ) : null}
                    </Label>
                  </div>
                );
              })}
            </RadioGroup>
          </section>
        </div>

        <SheetFooter className="flex-row gap-2 border-t border-border">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setDraft(resetFilterSheetDraft(query));
            }}
          >
            {FILTER_SHEET_RESET_LABEL}
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={!isApplicableFilterSheetDraft(draft, businessToday)}
            onClick={apply}
          >
            {FILTER_SHEET_APPLY_LABEL}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
