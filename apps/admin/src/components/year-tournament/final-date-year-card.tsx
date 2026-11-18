import { TriangleAlertIcon } from 'lucide-react';
import { type ReactNode, useId } from 'react';

import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { Badge } from '../../../lib/components/ui/badge/badge.tsx';
import type { AdminYearFinalDateSetting } from '../../graphql/admin-year-final-date.ts';
import { RoleGate } from '../layout/role-gate.tsx';
import {
  FINAL_DATE_ACCEPT_UNTIL_LABEL,
  FINAL_DATE_CHANGE_LOCK_AT_LABEL,
  FINAL_DATE_DRAW_AT_LABEL,
  FINAL_DATE_LABEL,
  FINAL_DATE_LOCKED_NOTICE,
  FINAL_DATE_NONE_LABEL,
  FINAL_DATE_SOURCE_LABELS,
  FINAL_DATE_SUPER_ADMIN_ONLY_NOTICE,
  FINAL_DATE_UPDATED_AT_LABEL,
  FINAL_DATE_UPDATED_BY_LABEL,
  formatFinalDateLabel,
  nextYearGapWarningOf,
  yearLabelOf,
} from './final-date-labels.ts';

const TERM_CLASS_NAME = 'text-muted-foreground';

interface ReadOnlyNoticeProps {
  readonly text: string;
}

function ReadOnlyNotice({ text }: ReadOnlyNoticeProps) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}

export interface FinalDateYearCardProps {
  readonly setting: AdminYearFinalDateSetting;
  // 変更の欄。最上位管理者が変更期限より前の年を開いた時だけ描く
  readonly children: ReactNode;
}

// 設定のページの決勝実施日の区画に並べる、対象年ごとの表示
export function FinalDateYearCard({
  setting,
  children,
}: FinalDateYearCardProps) {
  const headingId = useId();
  const {
    year,
    finalDate,
    source,
    acceptUntil,
    drawAt,
    changeLockAt,
    changeable,
    updatedAt,
    updatedBy,
    nextYearGapWarningDate,
  } = setting;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 text-card-foreground"
    >
      <h3 id={headingId} className="text-base font-semibold">
        {yearLabelOf(year)}
      </h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className={TERM_CLASS_NAME}>{FINAL_DATE_LABEL}</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <time dateTime={finalDate} className="font-semibold">
            {formatFinalDateLabel(finalDate)}
          </time>
          <Badge variant={source === 'EXPLICIT' ? 'default' : 'outline'}>
            {FINAL_DATE_SOURCE_LABELS[source]}
          </Badge>
        </dd>
        <dt className={TERM_CLASS_NAME}>{FINAL_DATE_ACCEPT_UNTIL_LABEL}</dt>
        <dd>
          <DateTime value={acceptUntil} format="longDateTime" />
        </dd>
        <dt className={TERM_CLASS_NAME}>{FINAL_DATE_DRAW_AT_LABEL}</dt>
        <dd>
          <DateTime value={drawAt} format="longDateTime" />
        </dd>
        <dt className={TERM_CLASS_NAME}>{FINAL_DATE_CHANGE_LOCK_AT_LABEL}</dt>
        <dd>
          <DateTime value={changeLockAt} format="longDateTime" />
        </dd>
        <dt className={TERM_CLASS_NAME}>{FINAL_DATE_UPDATED_AT_LABEL}</dt>
        <dd>
          {updatedAt === null ? (
            FINAL_DATE_NONE_LABEL
          ) : (
            <DateTime value={updatedAt} format="longDateTime" />
          )}
        </dd>
        <dt className={TERM_CLASS_NAME}>{FINAL_DATE_UPDATED_BY_LABEL}</dt>
        <dd className="break-words">
          {updatedBy?.nickname ?? FINAL_DATE_NONE_LABEL}
        </dd>
      </dl>
      {nextYearGapWarningDate === null ? null : (
        <p
          role="note"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          <TriangleAlertIcon
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-destructive"
          />
          <span>{nextYearGapWarningOf(nextYearGapWarningDate)}</span>
        </p>
      )}
      {/* 変更期限を過ぎた年は最上位管理者も変えられないため、ロールより先に期限の理由を示す */}
      {changeable ? (
        <RoleGate
          minimum="super_admin"
          fallback={
            <ReadOnlyNotice text={FINAL_DATE_SUPER_ADMIN_ONLY_NOTICE} />
          }
        >
          {children}
        </RoleGate>
      ) : (
        <ReadOnlyNotice text={FINAL_DATE_LOCKED_NOTICE} />
      )}
    </section>
  );
}
