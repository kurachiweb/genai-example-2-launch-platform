import { useState } from 'react';
import { StarIcon } from 'lucide-react';

import { cn } from '#/lib/utils';

type Props = {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
  size?: 'sm' | 'lg';
  disabled?: boolean;
  describedBy?: string;
};

const STARS = [1, 2, 3, 4, 5];

// 5つの星をラジオボタン群として扱い、矢印キーで選択を移動できるようにする
export function StarRatingInput({
  label,
  value,
  onChange,
  size = 'lg',
  disabled = false,
  describedBy,
}: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  const focusIndex = (value ?? 1) - 1;

  const handleKeyDown = (event: React.KeyboardEvent, star: number) => {
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -1
          : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = Math.min(5, Math.max(1, star + delta));
    onChange(next);
    const group = event.currentTarget.parentElement;
    group
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
      [next - 1]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-describedby={describedBy}
      aria-disabled={disabled}
      className="inline-flex items-center gap-0.5"
      onPointerLeave={() => setHover(null)}
    >
      {STARS.map((star, index) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`5段階中${star}`}
          tabIndex={index === focusIndex ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange(star)}
          onPointerEnter={() => !disabled && setHover(star)}
          onKeyDown={(event) => handleKeyDown(event, star)}
          className="rounded-md p-0.5 focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          <StarIcon
            aria-hidden="true"
            className={cn(
              size === 'lg' ? 'size-7' : 'size-5',
              star <= shown
                ? 'fill-primary text-primary'
                : 'fill-transparent text-muted-foreground/50',
            )}
          />
        </button>
      ))}
    </div>
  );
}
