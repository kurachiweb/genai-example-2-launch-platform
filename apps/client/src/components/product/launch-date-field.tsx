import { useQueryClient } from '@tanstack/react-query';
import { type FocusEvent, useCallback, useSyncExternalStore } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

import { FormField } from '../../../lib/components/form/form-field.tsx';
import { INLINE_LINK_CLASS_NAME } from '../../../lib/components/navigation/inline-link-class.ts';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { Calendar } from '../../../lib/components/ui/calendar/calendar.tsx';
import {
  invalidateMyProductQueries,
  type LaunchDateWindowView,
  type LaunchPlanView,
} from '../../graphql/my-products.ts';
import { PRICING_HREF } from '../layout/site-links.ts';
import { useBoundaryRefresh } from '../time/use-boundary-refresh.ts';
import { UltrasPromotionGate } from '../ultras/ultras-promotion-gate.tsx';
import {
  businessDateOf,
  kickoffAtOf,
  selectionCutoffsFrom,
} from './business-time.ts';
import { KickoffTime } from './kickoff-time.tsx';
import {
  businessDateOfCalendarDay,
  calendarDayOf,
  unavailableReasonOn,
} from './launch-date-calendar.ts';
import {
  type LaunchDateFieldValues,
  showsLaunchDateCalendar,
} from './launch-date-field-values.ts';
import { LaunchDateText } from './launch-date-text.tsx';
import {
  LAUNCH_DATE_PREFIX,
  PRICING_LINK_LABEL,
  RESERVE_NEXT_LAUNCH_LABEL,
  ULTRAS_RELAUNCH_PROMOTION,
  UNAVAILABLE_LAUNCH_DATE_REASONS,
} from './launch-messages.ts';
import { LaunchPlanNotice } from './launch-plan-notice.tsx';
import { LAUNCH_DATE_FIELD_LABEL } from './product-form-messages.ts';

export type LaunchDateFieldProps =
  | {
      readonly kind: 'register';
      // newProductLaunchWindowの選べる日
      readonly window: LaunchDateWindowView;
      readonly disabled?: boolean;
    }
  | {
      readonly kind: 'edit';
      readonly plan: LaunchPlanView;
      readonly productHandle: string;
      readonly disabled?: boolean;
    };

interface LaunchDateCalendarFieldProps {
  readonly window: LaunchDateWindowView;
  readonly label: string;
  // 真なら選んだ日を外せない(登録と、予定のローンチ日の変更)
  readonly required: boolean;
  readonly promotesUltras: boolean;
  readonly disabled: boolean;
}

const subscribeNothing = (): (() => void) => () => undefined;

const readBusinessToday = (): string => businessDateOf(new Date());

// 業務日付は表示中に締め切りの取り直しの描画で読み直せば足りるため購読しない
const useBusinessToday = (): string =>
  useSyncExternalStore(subscribeNothing, readBusinessToday, readBusinessToday);

function SelectedLaunchDate({ launchDate }: { readonly launchDate: string }) {
  return (
    <>
      <span className="block">
        {LAUNCH_DATE_PREFIX}
        <LaunchDateText date={launchDate} />
      </span>
      <span className="block">
        <KickoffTime kickoffAt={kickoffAtOf(launchDate)} />
      </span>
    </>
  );
}

function UltrasRelaunchPromotion() {
  return (
    <UltrasPromotionGate>
      <p className="text-sm">
        {ULTRAS_RELAUNCH_PROMOTION}
        <PathLink href={PRICING_HREF} className={INLINE_LINK_CLASS_NAME}>
          {PRICING_LINK_LABEL}
        </PathLink>
      </p>
    </UltrasPromotionGate>
  );
}

function LaunchDateCalendarField({
  window,
  label,
  required,
  promotesUltras,
  disabled,
}: LaunchDateCalendarFieldProps) {
  const { control } = useFormContext<LaunchDateFieldValues>();
  const launchDate = useWatch({ control, name: 'launchDate' });
  const queryClient = useQueryClient();
  const today = useBusinessToday();
  const refresh = useCallback(() => {
    void invalidateMyProductQueries(queryClient);
  }, [queryClient]);
  useBoundaryRefresh(selectionCutoffsFrom(today), refresh);
  const reasonOf = useCallback(
    (day: Date): string | undefined => {
      const reason = unavailableReasonOn(
        window,
        businessDateOfCalendarDay(day),
      );
      return reason === undefined
        ? undefined
        : UNAVAILABLE_LAUNCH_DATE_REASONS[reason];
    },
    [window],
  );

  return (
    <div className="flex flex-col gap-3">
      <FormField
        control={control}
        name="launchDate"
        label={label}
        description={
          launchDate === null ? undefined : (
            <SelectedLaunchDate launchDate={launchDate} />
          )
        }
        disabled={disabled}
      >
        {({
          value,
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
              selected={value === null ? undefined : calendarDayOf(value)}
              onSelect={(day) => {
                if (day !== undefined) {
                  onChange(businessDateOfCalendarDay(day));
                } else if (!required) {
                  onChange(null);
                }
              }}
              today={calendarDayOf(today)}
              defaultMonth={calendarDayOf(value ?? window.earliest)}
              startMonth={calendarDayOf(today)}
              endMonth={calendarDayOf(window.latest)}
              unavailableReasonOf={reasonOf}
              disabled={fieldDisabled}
            />
          </div>
        )}
      </FormField>
      {promotesUltras && <UltrasRelaunchPromotion />}
    </div>
  );
}

// 登録は選べる日のカレンダーを描く。編集は計画が予定のローンチ日の変更か次回のローンチの予約ならカレンダーを描き、予約できない・判定に失敗した・固定の期間なら予約の案内だけを描く
export function LaunchDateField(props: LaunchDateFieldProps) {
  const disabled = props.disabled ?? false;
  if (props.kind === 'register') {
    return (
      <LaunchDateCalendarField
        window={props.window}
        label={LAUNCH_DATE_FIELD_LABEL}
        required
        promotesUltras={false}
        disabled={disabled}
      />
    );
  }
  const { plan, productHandle } = props;
  if (!showsLaunchDateCalendar(plan)) {
    return (
      <LaunchPlanNotice
        plan={plan}
        productHandle={productHandle}
        placement="edit"
      />
    );
  }
  const reserving = plan.mode === 'new';
  return (
    <LaunchDateCalendarField
      window={plan.window}
      label={reserving ? RESERVE_NEXT_LAUNCH_LABEL : LAUNCH_DATE_FIELD_LABEL}
      required={!reserving}
      promotesUltras={
        plan.window.relaunchIntervalDays !== null && !plan.ultrasEntitled
      }
      disabled={disabled}
    />
  );
}
