import { useId, useState } from 'react';

import {
  type BusinessDateString,
  type PeriodRange,
  validateCustomRange,
} from '../../../common-lib/directory/directory-period.ts';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { Label } from '../../../lib/components/ui/label/label.tsx';
import {
  PERIOD_APPLY_LABEL,
  PERIOD_CANCEL_LABEL,
  PERIOD_FROM_LABEL,
  PERIOD_FUTURE_MESSAGE,
  PERIOD_ORDER_MESSAGE,
  PERIOD_RANGE_HINT,
  PERIOD_TO_LABEL,
} from './period-filter-messages.ts';
import {
  isApplicablePeriodRangeDraft,
  type PeriodRangeDraft,
  periodRangeOfDraft,
} from './period-range-draft.ts';

export interface PeriodRangeFormProps {
  // 呼び出し側が持つ下書き。絞り込みのシートはシートの下書きをそのまま渡す
  readonly value: PeriodRangeDraft;
  readonly businessToday: BusinessDateString;
  readonly onChange: (value: PeriodRangeDraft) => void;
  // 渡すとキャンセルと適用のボタンを置く。絞り込みのシートはシートの「適用」に任せて渡さない
  readonly onApply?: ((range: PeriodRange) => void) | undefined;
  readonly onCancel?: (() => void) | undefined;
}

type Field = keyof PeriodRangeDraft;

// 日付の入力欄は年・月・日の区画ごとに値が変わり、入力の途中の日付(年だけ直した日など)でも未来や逆順になるため、一度離れた欄でも入力し直す間は文言を外し、欄を離れた時に示す(入力のたびに検証し直す004の規則より要件のフォーカスアウト時の表示を優先する)
type FieldPhase = 'untouched' | 'editing' | 'left';

const INITIAL_PHASES: Readonly<Record<Field, FieldPhase>> = Object.freeze({
  from: 'untouched',
  to: 'untouched',
});

const describedByOf = (
  ...ids: readonly (string | false)[]
): string | undefined => {
  const joined = ids.filter((id) => id !== false).join(' ');
  return joined === '' ? undefined : joined;
};

export function PeriodRangeForm({
  value,
  businessToday,
  onChange,
  onApply,
  onCancel,
}: PeriodRangeFormProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const orderId = `${id}-order`;
  const [phases, setPhases] = useState(INITIAL_PHASES);
  const errors = validateCustomRange({ ...value, today: businessToday });
  const showsFutureOf = (field: Field): boolean =>
    errors[field] === 'future' && phases[field] === 'left';
  const showsOrder =
    errors.order === 'reversed' &&
    !Object.values(phases).includes('editing') &&
    Object.values(phases).includes('left');

  const fields: readonly { readonly field: Field; readonly label: string }[] = [
    { field: 'from', label: PERIOD_FROM_LABEL },
    { field: 'to', label: PERIOD_TO_LABEL },
  ];

  return (
    <div className="grid gap-3">
      <p id={hintId} className="text-xs text-muted-foreground">
        {PERIOD_RANGE_HINT}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {fields.map(({ field, label }) => {
          const inputId = `${id}-${field}`;
          const futureId = `${inputId}-future`;
          const showsFuture = showsFutureOf(field);
          return (
            <div key={field} className="grid content-start gap-1.5">
              <Label htmlFor={inputId} className="text-xs">
                {label}
              </Label>
              <Input
                id={inputId}
                type="date"
                max={businessToday}
                value={value[field]}
                aria-invalid={showsFuture || showsOrder ? true : undefined}
                aria-describedby={describedByOf(
                  hintId,
                  showsFuture && futureId,
                  showsOrder && orderId,
                )}
                onChange={(event) => {
                  setPhases((current) => ({ ...current, [field]: 'editing' }));
                  onChange({ ...value, [field]: event.target.value });
                }}
                onBlur={() => {
                  setPhases((current) => ({ ...current, [field]: 'left' }));
                }}
              />
              {showsFuture ? (
                <FormMessage id={futureId}>{PERIOD_FUTURE_MESSAGE}</FormMessage>
              ) : null}
            </div>
          );
        })}
      </div>
      {showsOrder ? (
        <FormMessage id={orderId}>{PERIOD_ORDER_MESSAGE}</FormMessage>
      ) : null}
      {onApply === undefined ? null : (
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            {PERIOD_CANCEL_LABEL}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!isApplicablePeriodRangeDraft(value, businessToday)}
            onClick={() => {
              onApply(periodRangeOfDraft(value));
            }}
          >
            {PERIOD_APPLY_LABEL}
          </Button>
        </div>
      )}
    </div>
  );
}
