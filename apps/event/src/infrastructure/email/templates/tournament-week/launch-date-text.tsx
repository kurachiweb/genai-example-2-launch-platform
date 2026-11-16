import type { ReactNode } from 'react';

interface LaunchDateTextProps {
  // 業務日付(YYYY-MM-DD)
  readonly date: string;
}

// 業務日付はUTCの時点ではないため、暦日のまま年を付けて表記し、(UTC)を添えない
function formatLaunchDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${String(year)}年${String(month)}月${String(day)}日`;
}

export function LaunchDateText({ date }: LaunchDateTextProps): ReactNode {
  return <time dateTime={date}>{formatLaunchDate(date)}</time>;
}
