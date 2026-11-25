import { StarIcon } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';

import { RATING_SCORES } from '../../../common-lib/engagement/engagement-rules.ts';
import { cn } from '../../../lib/utilities/class-names.ts';

export interface StarRatingInputProps {
  readonly label: string;
  readonly value: number | null;
  readonly onChange: (value: number) => void;
  readonly size?: 'sm' | 'lg';
  readonly disabled?: boolean;
  readonly describedBy?: string;
}

const MIN_STAR = Math.min(...RATING_SCORES);

const MAX_STAR = Math.max(...RATING_SCORES);

const STEP_BY_KEY: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowUp: 1,
  ArrowLeft: -1,
  ArrowDown: -1,
};

const starLabelOf = (star: number): string => `5段階中${String(star)}`;

// 5つの星を1つを選ぶラジオグループとして扱い、選んだ星だけをTabの停止位置にして矢印キーで選択を移す
export function StarRatingInput({
  label,
  value,
  onChange,
  size = 'lg',
  disabled = false,
  describedBy,
}: StarRatingInputProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const shown = (disabled ? null : hovered) ?? value ?? 0;
  const tabStop = value ?? MIN_STAR;

  // 同じ点数の書き込みと内容の変わらない通知を起こさないよう、値が変わる時だけ伝える
  const select = (star: number) => {
    if (star !== value) {
      onChange(star);
    }
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    star: number,
  ) => {
    const step = STEP_BY_KEY[event.key];
    if (step === undefined) {
      return;
    }
    event.preventDefault();
    const next = Math.min(MAX_STAR, Math.max(MIN_STAR, star + step));
    select(next);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
      [next - 1]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-describedby={describedBy}
      aria-disabled={disabled}
      className="inline-flex flex-wrap items-center gap-0.5"
      onPointerLeave={() => {
        setHovered(null);
      }}
    >
      {RATING_SCORES.map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={starLabelOf(star)}
          tabIndex={star === tabStop ? 0 : -1}
          disabled={disabled}
          onClick={() => {
            select(star);
          }}
          onPointerEnter={() => {
            setHovered(star);
          }}
          onKeyDown={(event) => {
            handleKeyDown(event, star);
          }}
          className="rounded-md p-0.5 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <StarIcon
            aria-hidden="true"
            className={cn(
              size === 'lg' ? 'size-7' : 'size-5',
              star <= shown
                ? 'fill-primary text-primary'
                : 'fill-transparent text-muted-foreground',
            )}
          />
        </button>
      ))}
    </div>
  );
}
