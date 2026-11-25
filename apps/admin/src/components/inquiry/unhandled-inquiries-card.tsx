import { useQuery } from '@tanstack/react-query';

import { NumberText } from '../../../lib/components/datetime/number-text.tsx';
import {
  adminUnhandledInquiryCountQueryOptions,
  GRAPHQL_INQUIRY_STATUS_OF,
} from '../../graphql/admin-inquiries.ts';
import { DashboardCardFrame } from '../dashboard/dashboard-card-frame.tsx';
import { dashboardCardStateOf } from '../dashboard/dashboard-card-state.ts';
import {
  INQUIRY_COUNT_UNIT,
  UNHANDLED_INQUIRIES_TITLE,
} from './admin-inquiries-messages.ts';

const UNHANDLED_INQUIRIES_HREF = `/inquiries?status=${GRAPHQL_INQUIRY_STATUS_OF.open}`;

export function UnhandledInquiriesCard() {
  const { data, error, isFetching, refetch } = useQuery(
    adminUnhandledInquiryCountQueryOptions(),
  );

  return (
    <DashboardCardFrame
      title={UNHANDLED_INQUIRIES_TITLE}
      href={UNHANDLED_INQUIRIES_HREF}
      state={dashboardCardStateOf({
        hasData: data !== undefined,
        error,
        isFetching,
        refetch,
      })}
    >
      <p className="text-4xl font-bold tabular-nums">
        <NumberText value={data?.adminUnhandledInquiryCount ?? 0} />
        <span className="text-base font-normal">{INQUIRY_COUNT_UNIT}</span>
      </p>
    </DashboardCardFrame>
  );
}
