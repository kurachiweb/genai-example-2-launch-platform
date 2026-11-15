import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from 'lucide-react';
import {
  type ComponentProps,
  createContext,
  type MouseEvent,
  use,
  useEffect,
  useRef,
} from 'react';
import {
  type ChevronProps,
  DayPicker,
  type DayButtonProps,
  getDefaultClassNames,
  type RootProps,
} from 'react-day-picker';
import { ja } from 'react-day-picker/locale/ja';

import { cn } from '../../../utilities/class-names.ts';
import { buttonVariants } from '../button/button-variants.ts';
import { Tooltip } from '../tooltip/tooltip.tsx';
import { TooltipContent } from '../tooltip/tooltip-content.tsx';
import { TooltipTrigger } from '../tooltip/tooltip-trigger.tsx';

export type UnavailableReasonOf = (date: Date) => string | undefined;

interface CalendarOwnProps {
  readonly unavailableReasonOf?: UnavailableReasonOf;
}

export type CalendarProps = ComponentProps<typeof DayPicker> & CalendarOwnProps;

const noUnavailableDays: UnavailableReasonOf = () => undefined;

const UnavailableReasonContext =
  createContext<UnavailableReasonOf>(noUnavailableDays);

function CalendarRoot({ className, rootRef, ...props }: RootProps) {
  return (
    <div
      data-slot="calendar"
      ref={rootRef}
      className={cn(className)}
      {...props}
    />
  );
}

function CalendarChevron({ className, orientation }: ChevronProps) {
  const Icon =
    orientation === 'left'
      ? ChevronLeftIcon
      : orientation === 'right'
        ? ChevronRightIcon
        : ChevronDownIcon;

  return <Icon aria-hidden="true" className={cn('size-4', className)} />;
}

// buttonVariantsはaria-disabledの間にポインターの操作を止め、選べない日の理由のツールチップが開かなくなるため使わない
const DAY_BUTTON_CLASS_NAME =
  'inline-flex aspect-square size-auto w-full min-w-(--cell-size) flex-col items-center justify-center gap-1 rounded-md text-sm leading-none font-normal transition-all hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:text-muted-foreground aria-disabled:line-through aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground data-[range-end=true]:rounded-md data-[range-end=true]:rounded-r-md data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-accent data-[range-middle=true]:text-accent-foreground data-[range-start=true]:rounded-md data-[range-start=true]:rounded-l-md data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:border-ring group-data-[focused=true]/day:ring-3 group-data-[focused=true]/day:ring-ring/50';

// 開いた元の要素の押下はツールチップを閉じるため、EnterやSpaceで押しても理由を示し続けるよう閉じる処理を止める
function keepReasonOpen(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}

function labelWithReason(
  label: string | undefined,
  reason: string | undefined,
): string | undefined {
  if (reason === undefined || label === undefined) {
    return label ?? reason;
  }
  return `${label}、${reason}`;
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  onClick,
  'aria-label': ariaLabel,
  'aria-disabled': ariaDisabled,
  ...props
}: DayButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const unavailableReasonOf = use(UnavailableReasonContext);
  const reason = unavailableReasonOf(day.date);

  useEffect(() => {
    if (modifiers.focused) {
      ref.current?.focus();
    }
  }, [modifiers.focused]);

  const button = (
    <button
      {...props}
      ref={ref}
      data-slot="calendar-day-button"
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(DAY_BUTTON_CLASS_NAME, className)}
      aria-label={labelWithReason(ariaLabel, reason)}
      aria-disabled={reason === undefined ? ariaDisabled : true}
      onClick={reason === undefined ? onClick : undefined}
    />
  );

  if (reason === undefined) {
    return button;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild onClick={keepReasonOpen}>
        {button}
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  locale = ja,
  components,
  unavailableReasonOf = noUnavailableDays,
  ...props
}: CalendarProps) {
  const defaultClassNames = getDefaultClassNames();
  const navButtonClassName = cn(
    buttonVariants({ variant: 'ghost' }),
    'size-(--cell-size) p-0 select-none',
  );

  return (
    <UnavailableReasonContext value={unavailableReasonOf}>
      <DayPicker
        showOutsideDays={showOutsideDays}
        locale={locale}
        className={cn(
          'group/calendar bg-background p-3 [--cell-size:--spacing(9)]',
          String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
          String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
          className,
        )}
        classNames={{
          root: cn('w-fit', defaultClassNames.root),
          months: cn(
            'relative flex flex-col gap-4 md:flex-row',
            defaultClassNames.months,
          ),
          month: cn('flex w-full flex-col gap-4', defaultClassNames.month),
          nav: cn(
            'absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1',
            defaultClassNames.nav,
          ),
          button_previous: cn(
            navButtonClassName,
            defaultClassNames.button_previous,
          ),
          button_next: cn(navButtonClassName, defaultClassNames.button_next),
          month_caption: cn(
            'flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)',
            defaultClassNames.month_caption,
          ),
          caption_label: cn(
            'text-sm font-medium select-none',
            defaultClassNames.caption_label,
          ),
          month_grid: 'w-full border-collapse',
          weekdays: cn('flex', defaultClassNames.weekdays),
          weekday: cn(
            'flex-1 rounded-md text-[0.8rem] font-normal text-muted-foreground select-none',
            defaultClassNames.weekday,
          ),
          week: cn('mt-2 flex w-full', defaultClassNames.week),
          day: cn(
            'group/day relative aspect-square h-full w-full p-0 text-center select-none [&:first-child[data-selected=true]_button]:rounded-l-md [&:last-child[data-selected=true]_button]:rounded-r-md',
            defaultClassNames.day,
          ),
          range_start: cn(
            'rounded-l-md bg-accent',
            defaultClassNames.range_start,
          ),
          range_middle: cn('rounded-none', defaultClassNames.range_middle),
          range_end: cn('rounded-r-md bg-accent', defaultClassNames.range_end),
          today: cn(
            'rounded-md bg-accent text-accent-foreground data-[selected=true]:rounded-none',
            defaultClassNames.today,
          ),
          outside: cn(
            'text-muted-foreground aria-selected:text-muted-foreground',
            defaultClassNames.outside,
          ),
          disabled: cn(
            'text-muted-foreground opacity-50',
            defaultClassNames.disabled,
          ),
          hidden: cn('invisible', defaultClassNames.hidden),
          ...classNames,
        }}
        components={{
          Root: CalendarRoot,
          Chevron: CalendarChevron,
          DayButton: CalendarDayButton,
          ...components,
        }}
        {...props}
      />
    </UnavailableReasonContext>
  );
}
