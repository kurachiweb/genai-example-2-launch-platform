import type { DashboardCardState } from './dashboard-card-frame.tsx';

export interface DashboardCardQueryResult {
  readonly hasData: boolean;
  readonly error: unknown;
  readonly isFetching: boolean;
  readonly refetch: () => unknown;
}

// 取り直しの失敗では表示中の値を残し、取り直している間は前の失敗を示さない
export const dashboardCardStateOf = ({
  hasData,
  error,
  isFetching,
  refetch,
}: DashboardCardQueryResult): DashboardCardState => {
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
