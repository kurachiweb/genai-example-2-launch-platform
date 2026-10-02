import { useRef, useState } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '#/components/ui/popover';

import {
  PERIOD_LABELS,
  PERIOD_PRESETS,
  periodKeyOf,
  presetRange,
} from '../-model/query';
import type { DateRange, PeriodPreset } from '../-model/query';
import { FilterTrigger } from './filter-trigger';
import { PeriodRangeForm } from './period-range-form';
import { useDirectoryFormat } from './use-directory-format';

type Props = {
  range: DateRange;
  onChange: (range: DateRange) => void;
};

// プリセットはメニューで選んで即座に反映し、「期間を指定…」だけは同じ位置に日付入力のポップオーバーを開く
export function PeriodFilter({ range, onChange }: Props) {
  const format = useDirectoryFormat();
  const triggerRef = useRef<HTMLButtonElement>(null);
  // メニューの選択操作やフォーカスの戻りを外側の操作と見なして閉じてしまわないよう、メニューが閉じ切ってからポップオーバーを開く
  const openingCustom = useRef(false);
  const [customOpen, setCustomOpen] = useState(false);
  const key = periodKeyOf(range);
  const label =
    key === 'custom' ? format.rangeLabel(range) : PERIOD_LABELS[key];

  return (
    <Popover open={customOpen} onOpenChange={setCustomOpen}>
      <DropdownMenu>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            <FilterTrigger
              ref={triggerRef}
              label="期間"
              value={label}
              active={key !== 'all'}
              className="max-w-80"
            />
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent
          align="start"
          className="w-48"
          onCloseAutoFocus={(event) => {
            if (openingCustom.current) {
              event.preventDefault();
              openingCustom.current = false;
              setCustomOpen(true);
            }
          }}
        >
          <DropdownMenuRadioGroup
            value={key}
            onValueChange={(next) => {
              if (next !== 'custom') {
                onChange(presetRange(next as PeriodPreset));
              }
            }}
          >
            {PERIOD_PRESETS.map((preset) => (
              <DropdownMenuRadioItem key={preset} value={preset}>
                {PERIOD_LABELS[preset]}
              </DropdownMenuRadioItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuRadioItem
              value="custom"
              onSelect={() => {
                openingCustom.current = true;
              }}
            >
              {PERIOD_LABELS.custom}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <PopoverContent
        align="start"
        className="w-80"
        aria-label="期間を指定"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
      >
        <p className="mb-2 text-sm font-bold">期間を指定</p>
        <PeriodRangeForm
          initial={key === 'custom' ? range : {}}
          onCancel={() => setCustomOpen(false)}
          onApply={(next) => {
            setCustomOpen(false);
            onChange(next);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
