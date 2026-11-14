import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import type { BusinessDateString } from '../../../common-lib/directory/directory-period.ts';
import {
  type DirectoryQuery,
  withConditions,
} from '../../../common-lib/directory/directory-query-rules.ts';
import { useDisplayPreferences } from '../../../lib/components/datetime/use-display-preferences.ts';
import { EmptyState } from '../../../lib/components/state/empty-state.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { formatNumber } from '../../../lib/utilities/number/number-format.ts';
import { ReserveLaunchLink } from '../product/reserve-launch-link.tsx';
import { directoryHref } from './directory-href.ts';
import {
  categoryConditionLabel,
  CLEAR_ALL_CONDITIONS_LABEL,
  CLEAR_CONDITION_SUFFIX,
  FILTERED_EMPTY_DESCRIPTION,
  FILTERED_EMPTY_TITLE,
  FIRST_PAGE_LABEL,
  keywordConditionLabel,
  NO_ENTRIES_DESCRIPTION,
  NO_ENTRIES_TITLE,
  OUT_OF_RANGE_TITLE,
  outOfRangeDescription,
  PERIOD_CONDITION_LABEL,
} from './directory-empty-state-messages.ts';
import { PeriodLabel } from './period-label.tsx';
import { UnmarkedPathLink } from './unmarked-path-link.tsx';

export type DirectoryEmptyStateProps =
  | {
      // 一致するプロダクトが0件。キーワード・カテゴリ・期間を指定中かで示し方を変える
      readonly kind: 'noResults';
      readonly query: DirectoryQuery;
      readonly categoryName: string | undefined;
      // APIサーバーが返した基準時刻の今日(YYYY-MM-DD)
      readonly businessToday: BusinessDateString;
      readonly signedIn: boolean;
    }
  | {
      // URLのページの番号が全ページ数を超えている
      readonly kind: 'outOfRange';
      readonly query: DirectoryQuery;
      readonly pageCount: number;
    };

type NoResultsProps = Extract<DirectoryEmptyStateProps, { kind: 'noResults' }>;

type OutOfRangeProps = Extract<
  DirectoryEmptyStateProps,
  { kind: 'outOfRange' }
>;

interface Condition {
  readonly key: string;
  readonly label: ReactNode;
  readonly patch: Partial<Omit<DirectoryQuery, 'page'>>;
}

const HEADING_LEVEL = 3;

const ALL_CONDITIONS_CLEARED = Object.freeze({
  q: undefined,
  category: undefined,
  from: undefined,
  to: undefined,
});

// 解除は絞り込みの条件だけを外し、並び順を保って1ページ目へ戻す
const conditionsOf = ({
  query,
  categoryName,
  businessToday,
}: NoResultsProps): readonly Condition[] => {
  const { q, category, from, to } = query;
  return [
    q === undefined
      ? null
      : { key: 'q', label: keywordConditionLabel(q), patch: { q: undefined } },
    category === undefined
      ? null
      : {
          key: 'category',
          label: categoryConditionLabel(categoryName ?? category),
          patch: { category: undefined },
        },
    from === undefined && to === undefined
      ? null
      : {
          key: 'period',
          label: (
            <>
              {PERIOD_CONDITION_LABEL.before}
              <PeriodLabel range={{ from, to }} businessToday={businessToday} />
              {PERIOD_CONDITION_LABEL.after}
            </>
          ),
          patch: { from: undefined, to: undefined },
        },
  ].filter((condition) => condition !== null);
};

function ClearConditionLink({
  href,
  primary,
  children,
}: {
  readonly href: string;
  readonly primary: boolean;
  readonly children: ReactNode;
}) {
  return (
    <Button
      asChild
      size="sm"
      variant={primary ? 'default' : 'outline'}
      className="h-auto min-h-8 max-w-full rounded-full py-1 whitespace-normal"
    >
      <UnmarkedPathLink href={href}>
        {primary ? null : <XIcon aria-hidden="true" />}
        <span className="wrap-anywhere">{children}</span>
      </UnmarkedPathLink>
    </Button>
  );
}

function FilteredEmptyState({
  query,
  conditions,
}: {
  readonly query: DirectoryQuery;
  readonly conditions: readonly Condition[];
}) {
  const single = conditions.length === 1;
  return (
    <EmptyState
      headingLevel={HEADING_LEVEL}
      title={FILTERED_EMPTY_TITLE}
      description={FILTERED_EMPTY_DESCRIPTION}
      action={
        <>
          {conditions.map(({ key, label, patch }) => (
            <ClearConditionLink
              key={key}
              href={directoryHref(withConditions(query, patch))}
              primary={single}
            >
              {label}
              {CLEAR_CONDITION_SUFFIX}
            </ClearConditionLink>
          ))}
          {single ? null : (
            <ClearConditionLink
              href={directoryHref(
                withConditions(query, ALL_CONDITIONS_CLEARED),
              )}
              primary
            >
              {CLEAR_ALL_CONDITIONS_LABEL}
            </ClearConditionLink>
          )}
        </>
      }
    />
  );
}

function OutOfRangeEmptyState({ query, pageCount }: OutOfRangeProps) {
  const preferences = useDisplayPreferences();
  return (
    <EmptyState
      headingLevel={HEADING_LEVEL}
      title={OUT_OF_RANGE_TITLE}
      description={outOfRangeDescription(formatNumber(pageCount, preferences))}
      action={
        <Button asChild>
          <UnmarkedPathLink href={directoryHref({ ...query, page: undefined })}>
            {FIRST_PAGE_LABEL}
          </UnmarkedPathLink>
        </Button>
      }
    />
  );
}

// 一覧が空の時に、条件の見直し・解除、ローンチの予約、1ページ目への導線のうち次の行動に合うものを添えて示す
export function DirectoryEmptyState(props: DirectoryEmptyStateProps) {
  if (props.kind === 'outOfRange') {
    return <OutOfRangeEmptyState {...props} />;
  }
  const conditions = conditionsOf(props);
  if (conditions.length > 0) {
    return <FilteredEmptyState query={props.query} conditions={conditions} />;
  }
  return (
    <EmptyState
      headingLevel={HEADING_LEVEL}
      title={NO_ENTRIES_TITLE}
      description={NO_ENTRIES_DESCRIPTION}
      action={<ReserveLaunchLink signedIn={props.signedIn} size="lg" />}
    />
  );
}
