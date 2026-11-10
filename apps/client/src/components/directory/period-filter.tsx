import { useId, useRef, useState } from 'react';

import {
  type BusinessDateString,
  PERIOD_PRESETS,
  type PeriodPreset,
  type PeriodRange,
  periodKeyOf,
  presetRange,
} from '../../../common-lib/directory/directory-period.ts';
import { DropdownMenu } from '../../../lib/components/ui/dropdown-menu/dropdown-menu.tsx';
import { DropdownMenuContent } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-content.tsx';
import { DropdownMenuRadioGroup } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-radio-group.tsx';
import { DropdownMenuRadioItem } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-radio-item.tsx';
import { DropdownMenuSeparator } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-separator.tsx';
import { DropdownMenuTrigger } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-trigger.tsx';
import { Popover } from '../../../lib/components/ui/popover/popover.tsx';
import { PopoverAnchor } from '../../../lib/components/ui/popover/popover-anchor.tsx';
import { PopoverContent } from '../../../lib/components/ui/popover/popover-content.tsx';
import { PopoverTitle } from '../../../lib/components/ui/popover/popover-title.tsx';
import { FilterTrigger } from './filter-trigger.tsx';
import {
  PERIOD_FILTER_LABEL,
  PERIOD_OPTION_LABELS,
  PERIOD_RANGE_TITLE,
} from './period-filter-messages.ts';
import { PeriodLabel } from './period-label.tsx';
import {
  EMPTY_PERIOD_RANGE_DRAFT,
  periodRangeDraftOf,
} from './period-range-draft.ts';
import { PeriodRangeForm } from './period-range-form.tsx';

export interface PeriodFilterProps {
  // URLから正規化した適用中の期間
  readonly range: PeriodRange;
  // APIサーバーが返した基準時刻の今日(YYYY-MM-DD)
  readonly businessToday: BusinessDateString;
  // 条件の上書きで指定の無い端を消せるよう、両端の項目を必ず持たせて知らせる
  readonly onChange: (range: PeriodRange) => void;
}

const CUSTOM_VALUE = 'custom';

const presetOf = (value: string): PeriodPreset | undefined =>
  PERIOD_PRESETS.find((preset) => preset === value);

const isSameRange = (left: PeriodRange, right: PeriodRange): boolean =>
  left.from === right.from && left.to === right.to;

// プリセットはメニューで選んで即座に知らせ、「期間を指定…」だけは選択欄の位置に日付の入力のポップオーバーを開く
export function PeriodFilter({
  range,
  businessToday,
  onChange,
}: PeriodFilterProps) {
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  // メニューを閉じる途中のフォーカスの戻りをポップオーバーの外側の操作と見なして閉じないよう、メニューが閉じ切ってから開く
  const openingCustomRef = useRef(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY_PERIOD_RANGE_DRAFT);
  const key = periodKeyOf(range, businessToday);

  const notify = (next: PeriodRange) => {
    if (!isSameRange(next, range)) {
      onChange({ from: next.from, to: next.to });
    }
  };

  return (
    <Popover modal open={customOpen} onOpenChange={setCustomOpen}>
      <DropdownMenu>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            <FilterTrigger
              ref={triggerRef}
              label={PERIOD_FILTER_LABEL}
              value={
                <PeriodLabel range={range} businessToday={businessToday} />
              }
              className="max-w-80"
            />
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent
          align="start"
          className="w-48"
          onCloseAutoFocus={(event) => {
            if (openingCustomRef.current) {
              event.preventDefault();
              openingCustomRef.current = false;
              setDraft(
                key === CUSTOM_VALUE
                  ? periodRangeDraftOf(range)
                  : EMPTY_PERIOD_RANGE_DRAFT,
              );
              setCustomOpen(true);
            }
          }}
        >
          <DropdownMenuRadioGroup
            value={key}
            onValueChange={(value) => {
              const preset = presetOf(value);
              if (preset !== undefined) {
                notify(presetRange(preset, businessToday));
              }
            }}
          >
            {PERIOD_PRESETS.map((preset) => (
              <DropdownMenuRadioItem key={preset} value={preset}>
                {PERIOD_OPTION_LABELS[preset]}
              </DropdownMenuRadioItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuRadioItem
              value={CUSTOM_VALUE}
              onSelect={() => {
                openingCustomRef.current = true;
              }}
            >
              {PERIOD_OPTION_LABELS.custom}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <PopoverContent
        align="start"
        aria-labelledby={titleId}
        className="w-80"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
      >
        <PopoverTitle id={titleId} className="mb-2 text-sm font-bold">
          {PERIOD_RANGE_TITLE}
        </PopoverTitle>
        <PeriodRangeForm
          value={draft}
          businessToday={businessToday}
          onChange={setDraft}
          onCancel={() => {
            setCustomOpen(false);
          }}
          onApply={(next) => {
            setCustomOpen(false);
            notify(next);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
