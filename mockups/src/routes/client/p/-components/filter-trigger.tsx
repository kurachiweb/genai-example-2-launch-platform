import { ChevronDownIcon } from 'lucide-react';

import { Button } from '#/components/ui/button';
import { cn } from '#/lib/utils';

type Props = React.ComponentProps<'button'> & {
  label: string;
  value: string;
  // 既定値から変更している
  active: boolean;
};

// 「カテゴリ 全て ▾」のように項目名と選択中の値を並べる。長い値は省略表示し、読み上げでは全文を読む
export function FilterTrigger({
  label,
  value,
  active,
  className,
  ...props
}: Props) {
  return (
    <Button
      type="button"
      variant="outline"
      className={cn(
        'h-9 max-w-full min-w-0 justify-start gap-1.5 rounded-lg px-3',
        active &&
          'border-primary/60 bg-primary/5 hover:bg-primary/10 dark:border-primary/50 dark:bg-primary/10',
        className,
      )}
      {...props}
    >
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-semibold">{value}</span>
      <ChevronDownIcon
        className="ml-auto shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    </Button>
  );
}
