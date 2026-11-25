import { useId } from 'react';

import { ADMIN_LAUNCH_STATE_LABELS } from '../../../../common-lib/moderation/moderation-labels.ts';
import { formatBusinessDateWithWeekdayLabel } from '../../../../common-lib/time/business-date-label.ts';
import { Table } from '../../../../lib/components/ui/table/table.tsx';
import { TableBody } from '../../../../lib/components/ui/table/table-body.tsx';
import { TableCaption } from '../../../../lib/components/ui/table/table-caption.tsx';
import { TableCell } from '../../../../lib/components/ui/table/table-cell.tsx';
import { TableHead } from '../../../../lib/components/ui/table/table-head.tsx';
import { TableHeader } from '../../../../lib/components/ui/table/table-header.tsx';
import { TableRow } from '../../../../lib/components/ui/table/table-row.tsx';
import type { AdminModerationLaunchView } from '../../../graphql/admin-moderation-products.ts';
import {
  LAUNCH_ITEM_LABELS,
  launchHeading,
  MATCH_RESULT_COLUMNS,
  matchResultsCaption,
  NO_LAUNCHES_MESSAGE,
  NO_MATCHES_MESSAGE,
  NO_VALUE_LABEL,
  PRODUCT_DETAIL_COPY,
} from '../shared/moderation-messages.ts';
import {
  matchKindLabel,
  matchOpponentLabel,
  matchResultLabel,
  matchRoundLabel,
  matchUpvoteLabel,
} from './match-result-labels.ts';

export interface ProductLaunchesPanelProps {
  // ローンチ日の新しい順
  readonly launches: readonly AdminModerationLaunchView[];
}

const COLUMN_KEYS = Object.freeze([
  'kind',
  'round',
  'matchDate',
  'opponent',
  'upvoteCount',
  'result',
] as const satisfies readonly (keyof typeof MATCH_RESULT_COLUMNS)[]);

function BusinessDate({ date }: { readonly date: string }) {
  return (
    <time dateTime={date}>{formatBusinessDateWithWeekdayLabel(date)}</time>
  );
}

function LaunchItem({
  launch,
}: {
  readonly launch: AdminModerationLaunchView;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="font-bold">
        {launchHeading(launch.number)}
      </h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">
          {LAUNCH_ITEM_LABELS.launchDate}
        </dt>
        <dd>
          <BusinessDate date={launch.launchDate} />
        </dd>
        <dt className="text-muted-foreground">{LAUNCH_ITEM_LABELS.state}</dt>
        <dd>
          {launch.state === null
            ? NO_VALUE_LABEL
            : ADMIN_LAUNCH_STATE_LABELS[launch.state]}
        </dd>
      </dl>
      {launch.matches.length === 0 ? (
        <p className="text-sm text-muted-foreground">{NO_MATCHES_MESSAGE}</p>
      ) : (
        <Table>
          <TableCaption className="sr-only">
            {matchResultsCaption(launch.number)}
          </TableCaption>
          <TableHeader>
            <TableRow>
              {COLUMN_KEYS.map((key) => (
                <TableHead key={key} scope="col">
                  {MATCH_RESULT_COLUMNS[key]}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {launch.matches.map((match) => (
              <TableRow key={match.id}>
                <TableCell>{matchKindLabel(match.kind)}</TableCell>
                <TableCell>{matchRoundLabel(match)}</TableCell>
                <TableCell>
                  <BusinessDate date={match.matchDate} />
                </TableCell>
                <TableCell className="wrap-anywhere whitespace-normal">
                  {matchOpponentLabel(match)}
                </TableCell>
                <TableCell>{matchUpvoteLabel(match)}</TableCell>
                <TableCell>{matchResultLabel(match)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

// ローンチごとに回・ローンチ日・状態と、そのローンチのマッチ結果を新しいローンチから順に示す
export function ProductLaunchesPanel({ launches }: ProductLaunchesPanelProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-6 rounded-lg border border-border bg-card p-4 sm:p-6"
    >
      <h2 id={headingId} className="text-lg font-extrabold">
        {PRODUCT_DETAIL_COPY.sections.launches}
      </h2>
      {launches.length === 0 ? (
        <p className="text-sm text-muted-foreground">{NO_LAUNCHES_MESSAGE}</p>
      ) : (
        launches.map((launch) => <LaunchItem key={launch.id} launch={launch} />)
      )}
    </section>
  );
}
