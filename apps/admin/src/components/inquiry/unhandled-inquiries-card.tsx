import { useQuery } from '@tanstack/react-query';

import { NumberText } from '../../../lib/components/datetime/number-text.tsx';
import {
  adminUnhandledInquiryCountQueryOptions,
  GRAPHQL_INQUIRY_STATUS_OF,
} from '../../graphql/admin-inquiries.ts';
import {
  DashboardCardFrame,
  type DashboardCardState,
} from '../dashboard/dashboard-card-frame.tsx';
import {
  INQUIRY_COUNT_UNIT,
  UNHANDLED_INQUIRIES_TITLE,
} from './admin-inquiries-messages.ts';

const UNHANDLED_INQUIRIES_HREF = `/inquiries?status=${GRAPHQL_INQUIRY_STATUS_OF.open}`;

interface CountQueryResult {
  readonly hasData: boolean;
  readonly error: unknown;
  readonly isFetching: boolean;
  readonly refetch: () => unknown;
}

// 取り直しの失敗では表示中の件数を残し、取り直している間は前の失敗を示さない
const cardStateOf = ({
  hasData,
  error,
  isFetching,
  refetch,
}: CountQueryResult): DashboardCardState => {
  if (hasData) {
    return { status: 'success' };
  }
  if (error === null || isFetching) {
    return { status: 'pending' };
  }
  return {
    status: 'error',
    error,
    retry: () => {
      void refetch();
    },
  };
};

export function UnhandledInquiriesCard() {
  const { data, error, isFetching, refetch } = useQuery(
    adminUnhandledInquiryCountQueryOptions(),
  );

  return (
    <DashboardCardFrame
      title={UNHANDLED_INQUIRIES_TITLE}
      href={UNHANDLED_INQUIRIES_HREF}
      state={cardStateOf({
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
