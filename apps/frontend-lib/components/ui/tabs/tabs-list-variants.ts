import { cva, type VariantProps } from 'class-variance-authority';

export const tabsListVariants = cva(
  'group/tabs-list inline-flex w-fit flex-wrap items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-[orientation=horizontal]/tabs:min-h-9 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:rounded-none',
  {
    variants: {
      variant: {
        default: 'bg-muted',
        line: 'gap-1',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export type TabsListVariantProps = VariantProps<typeof tabsListVariants>;

export type TabsListVariant = NonNullable<TabsListVariantProps['variant']>;
