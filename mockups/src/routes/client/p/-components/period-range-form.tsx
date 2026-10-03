import { useId, useState } from 'react';

import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { Label } from '#/components/ui/label';

import { TODAY } from '../-model/calendar';
import type { DateRange } from '../-model/query';

type Props = {
  initial: DateRange;
  // ポップオーバーでは「適用」ボタンを置く。絞り込みシートではシート側の「適用」に任せ、変更と妥当性だけを伝える
  onApply?: (range: DateRange) => void;
  onCancel?: () => void;
  onChange?: (range: DateRange, valid: boolean) => void;
};

function errorOf(from: string, to: string): string | null {
  if ((from && from > TODAY) || (to && to > TODAY)) {
    return '未来の日付は選べません。';
  }
  if (from && to && from > to) {
    return '開始日は終了日以前の日付を選んでください。';
  }
  return null;
}

function isValid(from: string, to: string): boolean {
  return Boolean(from || to) && errorOf(from, to) === null;
}

// 開始日・終了日の片方だけでも指定できる。エラーはフォーカスを外した時に示す(UI-004)
export function PeriodRangeForm({
  initial,
  onApply,
  onCancel,
  onChange,
}: Props) {
  const fromId = useId();
  const toId = useId();
  const errorId = useId();
  const hintId = useId();
  const [from, setFrom] = useState(initial.from ?? '');
  const [to, setTo] = useState(initial.to ?? '');
  const [touched, setTouched] = useState(false);
  const error = touched ? errorOf(from, to) : null;

  const update = (nextFrom: string, nextTo: string) => {
    setFrom(nextFrom);
    setTo(nextTo);
    onChange?.(
      { from: nextFrom || undefined, to: nextTo || undefined },
      isValid(nextFrom, nextTo),
    );
  };

  const describedBy = [hintId, error && errorId].filter(Boolean).join(' ');

  return (
    <div className="grid gap-3">
      <p id={hintId} className="text-xs text-muted-foreground">
        片方だけ入力すると、その日以降・以前のローンチで絞り込みます。
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor={fromId} className="text-xs">
            開始日
          </Label>
          <Input
            id={fromId}
            type="date"
            max={TODAY}
            value={from}
            onChange={(event) => update(event.target.value, to)}
            onBlur={() => setTouched(true)}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={toId} className="text-xs">
            終了日
          </Label>
          <Input
            id={toId}
            type="date"
            max={TODAY}
            value={to}
            onChange={(event) => update(from, event.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
          />
        </div>
      </div>
      {error && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
      {onApply && (
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            キャンセル
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!isValid(from, to) || Boolean(error)}
            onClick={() => {
              setTouched(true);
              if (isValid(from, to)) {
                onApply({ from: from || undefined, to: to || undefined });
              }
            }}
          >
            適用
          </Button>
        </div>
      )}
    </div>
  );
}
