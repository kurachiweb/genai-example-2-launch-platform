import { useMemo, useState } from 'react';

import { countGraphemes } from '../../../common-lib/text/graphemes.ts';
import { cn } from '../../utilities/class-names.ts';
import {
  formatCount,
  LENGTH_WITHIN_LIMIT_ANNOUNCEMENT,
  lengthOverLimitAnnouncement,
} from '../../utilities/messages/markdown-messages.ts';

export interface MarkdownLengthCounterProps {
  readonly value: string;
  readonly max: number;
  readonly className?: string;
}

export function MarkdownLengthCounter({
  value,
  max,
  className,
}: MarkdownLengthCounterProps) {
  const count = useMemo(() => countGraphemes(value), [value]);
  const exceeded = count > max;
  const [announcedExceeded, setAnnouncedExceeded] = useState(exceeded);
  const [announcement, setAnnouncement] = useState('');

  // 入力のたびに読み上げないよう、上限を超えた時と上限以内に戻った時だけ読み上げの文言を変える
  if (exceeded !== announcedExceeded) {
    setAnnouncedExceeded(exceeded);
    setAnnouncement(
      exceeded
        ? lengthOverLimitAnnouncement(max)
        : LENGTH_WITHIN_LIMIT_ANNOUNCEMENT,
    );
  }

  return (
    <div data-slot="markdown-length-counter" className={className}>
      <p
        className={cn(
          'text-xs tabular-nums',
          exceeded ? 'font-medium text-destructive' : 'text-muted-foreground',
        )}
      >
        {formatCount(count)} / {formatCount(max)}
      </p>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
