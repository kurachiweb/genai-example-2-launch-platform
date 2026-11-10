import { ChevronDownIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '../../../lib/components/ui/button/button.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';

export interface FilterTriggerProps extends Omit<
  ComponentProps<typeof Button>,
  'children'
> {
  readonly label: string;
  readonly value: string;
}

// 開閉の部品のトリガーの子として使うため、受け取ったpropsとrefをボタンへ渡す。項目名と値の間の空白は、横並びの表示には出ず、名前を「<項目名> <値>」と区切って読ませる
export function FilterTrigger({
  label,
  value,
  className,
  ...props
}: FilterTriggerProps) {
  return (
    <Button
      variant="outline"
      className={cn(
        'h-9 max-w-full min-w-0 justify-start gap-1.5 rounded-lg px-3',
        className,
      )}
      {...props}
    >
      <span className="shrink-0 text-muted-foreground">{label}</span>{' '}
      <span className="min-w-0 truncate font-semibold">{value}</span>
      <ChevronDownIcon
        aria-hidden="true"
        className="ml-auto shrink-0 text-muted-foreground"
      />
    </Button>
  );
}
