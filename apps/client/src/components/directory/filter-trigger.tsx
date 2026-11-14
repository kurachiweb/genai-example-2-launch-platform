import { ChevronDownIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Button } from '../../../lib/components/ui/button/button.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';

export interface FilterTriggerProps extends Omit<
  ComponentProps<typeof Button>,
  'children' | 'value'
> {
  readonly label: string;
  // 日付を<time>要素で示す値を渡せるよう、文字列に限らない。ボタンのvalue属性には渡さない
  readonly value: ReactNode;
  // 既定の値から変えている。選んだ値は文言でも示すため、強調は見つけやすくするための補助
  readonly active?: boolean | undefined;
}

// 開閉の部品のトリガーの子として使うため、受け取ったpropsとrefをボタンへ渡す。項目名と値の間の空白は、横並びの表示には出ず、名前を「<項目名> <値>」と区切って読ませる
export function FilterTrigger({
  label,
  value,
  active = false,
  className,
  ...props
}: FilterTriggerProps) {
  return (
    <Button
      variant="outline"
      data-active={active ? 'true' : undefined}
      className={cn(
        'h-9 max-w-full min-w-0 justify-start gap-1.5 rounded-lg px-3',
        active &&
          'border-primary/60 bg-primary/5 hover:bg-primary/10 dark:border-primary/50 dark:bg-primary/10',
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
