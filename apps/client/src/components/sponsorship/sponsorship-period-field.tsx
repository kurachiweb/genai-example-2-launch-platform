import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  type FocusEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

import { FormField } from '../../../lib/components/form/form-field.tsx';
import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { PartialErrorState } from '../../../lib/components/state/partial-error-state.tsx';
import { Calendar } from '../../../lib/components/ui/calendar/calendar.tsx';
import { Skeleton } from '../../../lib/components/ui/skeleton/skeleton.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import type { BusinessDateString } from '../../../common-lib/sponsorship/sponsorship-period.ts';
import { formatBusinessDateLabel } from '../../../common-lib/time/business-date-label.ts';
import type { SponsorshipTier } from '../../../common-lib/sponsorship/sponsorship-tiers.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import {
  invalidateSponsorshipPeriodWindowQueries,
  sponsorshipPeriodWindowQueryOptions,
} from '../../graphql/sponsorship.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { useCurrentYear } from '../product/use-current-year.ts';
import {
  businessDateOfCalendarDay,
  calendarDayOf,
} from '../time/business-date-calendar.ts';
import { useBoundaryRefresh } from '../time/use-boundary-refresh.ts';
import {
  type SponsorshipDateFieldKind,
  type SponsorshipDateWindowView,
  sponsorshipUnavailableReasonOn,
} from './sponsorship-date-reasons.ts';
import {
  SPONSORSHIP_DATE_REASON_MESSAGES,
  SPONSORSHIP_FORM_LABELS,
} from './sponsorship-messages.ts';

// 掲載期間の欄が読み書きするフォームの値。申込の入力と同じ業務日付(YYYY-MM-DD)で持ち、nullは未選択
export interface SponsorshipPeriodFieldValues {
  startsOn: BusinessDateString | null;
  endsOn: BusinessDateString | null;
}

export interface SponsorshipPeriodFieldProps {
  readonly viewer: ClientViewer;
  // プロダクトとティアを選ぶまではnullで、その間は範囲を照会せず欄を描かない
  readonly productId: string | null;
  readonly tier: SponsorshipTier | null;
  readonly disabled?: boolean;
}

interface PeriodCalendarsProps {
  readonly viewer: ClientViewer;
  readonly productId: string;
  readonly tier: SponsorshipTier;
  readonly disabled: boolean;
}

interface DateCalendarFieldProps {
  readonly name: keyof SponsorshipPeriodFieldValues;
  readonly kind: SponsorshipDateFieldKind;
  readonly window: SponsorshipDateWindowView;
  readonly businessToday: BusinessDateString;
  readonly disabled: boolean;
  readonly onSelectDate?: (date: BusinessDateString) => void;
}

const NO_BOUNDARIES: readonly string[] = Object.freeze([]);

const FIELD_LABELS: Readonly<Record<SponsorshipDateFieldKind, string>> =
  Object.freeze({
    start: SPONSORSHIP_FORM_LABELS.startsOn,
    end: SPONSORSHIP_FORM_LABELS.endsOn,
  });

const CALENDAR_SKELETON = <Skeleton className="h-80 w-72" />;

const earlierOf = (a: BusinessDateString, b: BusinessDateString) =>
  a < b ? a : b;

const laterOf = (a: BusinessDateString, b: BusinessDateString) =>
  a > b ? a : b;

// 終了日の重なりの範囲は最も遅い日より後に並ぶため、重なりの理由の日まで月を移れるようにする
const lastShownDateOf = (window: SponsorshipDateWindowView) =>
  window.unavailable.reduce((last, { to }) => laterOf(last, to), window.latest);

function SelectedDate({
  date,
  reason,
}: {
  readonly date: BusinessDateString;
  readonly reason: string | undefined;
}) {
  const currentYear = useCurrentYear();
  return (
    <>
      <span className="block">
        <time dateTime={date}>
          {formatBusinessDateLabel(date, currentYear)}
        </time>
      </span>
      {reason === undefined ? null : (
        <span className="block text-destructive">{reason}</span>
      )}
    </>
  );
}

function DateCalendarField({
  name,
  kind,
  window,
  businessToday,
  disabled,
  onSelectDate,
}: DateCalendarFieldProps) {
  const { control } = useFormContext<SponsorshipPeriodFieldValues>();
  const value = useWatch({ control, name });
  const reasonOf = useCallback(
    (day: Date): string | undefined => {
      const reason = sponsorshipUnavailableReasonOn(
        window,
        businessDateOfCalendarDay(day),
        kind,
      );
      return reason === undefined
        ? undefined
        : SPONSORSHIP_DATE_REASON_MESSAGES[reason];
    },
    [window, kind],
  );
  const selectedReason =
    value === null
      ? undefined
      : sponsorshipUnavailableReasonOn(window, value, kind);
  const lastShownDate = lastShownDateOf(window);
  // 開始日の選び直しで範囲の外になった終了日は外すため、示せる月の外の選択では範囲の最初の月から示す
  const firstShownDate =
    value !== null && window.earliest <= value && value <= lastShownDate
      ? value
      : window.earliest;

  return (
    <FormField
      control={control}
      name={name}
      label={FIELD_LABELS[kind]}
      description={
        value === null ? undefined : (
          <SelectedDate
            date={value}
            reason={
              selectedReason === undefined
                ? undefined
                : SPONSORSHIP_DATE_REASON_MESSAGES[selectedReason]
            }
          />
        )
      }
      disabled={disabled}
    >
      {({
        onChange,
        onBlur,
        ref,
        id,
        labelId,
        disabled: fieldDisabled,
        'aria-describedby': describedBy,
      }) => (
        <div
          role="group"
          id={id}
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          className="w-fit rounded-md border"
          ref={(element) => {
            // 送信の検証の失敗で欄へフォーカスを移す時は、カレンダーのTabの停止位置の日へ移す
            ref(
              element === null
                ? null
                : {
                    focus: () => {
                      element
                        .querySelector<HTMLElement>(
                          '[data-slot="calendar-day-button"][tabindex="0"]',
                        )
                        ?.focus();
                    },
                  },
            );
          }}
          onBlur={(event: FocusEvent<HTMLDivElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              onBlur();
            }
          }}
        >
          <Calendar
            mode="single"
            required
            selected={value === null ? undefined : calendarDayOf(value)}
            onSelect={(day: Date) => {
              const date = businessDateOfCalendarDay(day);
              if (date === value) {
                return;
              }
              onChange(date);
              onSelectDate?.(date);
            }}
            today={calendarDayOf(businessToday)}
            defaultMonth={calendarDayOf(firstShownDate)}
            startMonth={calendarDayOf(
              earlierOf(businessToday, value ?? businessToday),
            )}
            endMonth={calendarDayOf(
              laterOf(lastShownDate, value ?? lastShownDate),
            )}
            unavailableReasonOf={reasonOf}
            disabled={fieldDisabled}
          />
        </div>
      )}
    </FormField>
  );
}

function CalendarLoading() {
  return (
    <LoadingSkeleton className="w-fit">{CALENDAR_SKELETON}</LoadingSkeleton>
  );
}

function PeriodCalendars({
  viewer,
  productId,
  tier,
  disabled,
}: PeriodCalendarsProps) {
  const { control, getValues, setValue } =
    useFormContext<SponsorshipPeriodFieldValues>();
  const startsOn = useWatch({ control, name: 'startsOn' });
  const queryClient = useQueryClient();
  // 開始日を選ぶたびに照会が変わるため、選び直しの間も開始日のカレンダーを前の範囲で示し続ける
  const query = useQuery({
    ...sponsorshipPeriodWindowQueryOptions(viewer, {
      productId,
      tier,
      startsOn,
    }),
    placeholderData: keepPreviousData,
  });
  // 開始日を選び直した時だけ、その開始日の終了日の範囲が届いてから範囲の外の終了日を外す。0:00の取り直しでは入力中の値を消さない
  const endCheckRef = useRef<BusinessDateString | null>(null);
  const periodWindow = query.isPlaceholderData
    ? undefined
    : query.data?.sponsorshipPeriodWindow;
  // 開始日を以前に選んだことがあれば古い範囲が先に返るため、取り直しの後の範囲で確かめる
  const checkable = periodWindow !== undefined && !query.isFetching;

  useEffect(() => {
    const checking = endCheckRef.current;
    if (!checkable || checking === null || checking !== startsOn) {
      return;
    }
    endCheckRef.current = null;
    const endsOn = getValues('endsOn');
    if (
      periodWindow.end !== null &&
      endsOn !== null &&
      sponsorshipUnavailableReasonOn(periodWindow.end, endsOn, 'end') !==
        undefined
    ) {
      setValue('endsOn', null);
    }
  }, [checkable, periodWindow, startsOn, getValues, setValue]);

  const refresh = useCallback(() => {
    void invalidateSponsorshipPeriodWindowQueries(queryClient);
  }, [queryClient]);
  const shown = query.data?.sponsorshipPeriodWindow;
  useBoundaryRefresh(
    shown === undefined ? NO_BOUNDARIES : [shown.nextDayStartsAt],
    refresh,
  );

  const failure =
    query.isError && !query.isFetching ? (
      <PartialErrorState
        message={errorMessageOf(query.error, CLIENT_PROFILE.contactAvailable)}
        onRetry={() => {
          void query.refetch();
        }}
      />
    ) : null;

  if (shown === undefined) {
    return failure ?? <CalendarLoading />;
  }

  const selectStart = (date: BusinessDateString): void => {
    endCheckRef.current = getValues('endsOn') === null ? null : date;
  };

  let endCalendar: ReactNode = null;
  if (startsOn !== null) {
    if (periodWindow === undefined) {
      endCalendar = <CalendarLoading />;
    } else if (periodWindow.end !== null) {
      endCalendar = (
        <DateCalendarField
          key={startsOn}
          name="endsOn"
          kind="end"
          window={periodWindow.end}
          businessToday={shown.businessToday}
          disabled={disabled}
        />
      );
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {failure}
      <div className="flex flex-wrap gap-6">
        <DateCalendarField
          name="startsOn"
          kind="start"
          window={shown.start}
          businessToday={shown.businessToday}
          disabled={disabled}
          onSelectDate={selectStart}
        />
        {endCalendar}
      </div>
    </div>
  );
}

// 開始日と終了日の2つのカレンダーを画面に直接置き、選べる範囲をサーバーから受け取る。プロダクトかティアを選び直したら前の範囲を引き継がないよう欄を作り直す
export function SponsorshipPeriodField({
  viewer,
  productId,
  tier,
  disabled = false,
}: SponsorshipPeriodFieldProps) {
  if (productId === null || tier === null) {
    return null;
  }
  return (
    <PeriodCalendars
      key={`${productId}:${tier}`}
      viewer={viewer}
      productId={productId}
      tier={tier}
      disabled={disabled}
    />
  );
}
