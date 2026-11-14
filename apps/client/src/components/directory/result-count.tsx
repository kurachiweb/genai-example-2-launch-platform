import { DIRECTORY_PAGE_SIZE } from '../../../common-lib/directory/directory-query-rules.ts';
import { useDisplayPreferences } from '../../../lib/components/datetime/use-display-preferences.ts';
import { formatNumber } from '../../../lib/utilities/number/number-format.ts';
import {
  pagedCountText,
  RESULT_COUNT_LOADING,
  singlePageCountText,
} from './result-count-messages.ts';

export interface ResultCountProps {
  readonly totalCount: number;
  // 1から数える表示中のページ
  readonly page: number;
  readonly pageCount: number;
  // 条件の変更の後に一覧を読み込み直している間
  readonly loading: boolean;
}

// 条件の変更で件数が変わったことを、一覧の操作を妨げずに支援技術へ伝える
export function ResultCount({
  totalCount,
  page,
  pageCount,
  loading,
}: ResultCountProps) {
  const preferences = useDisplayPreferences();
  const format = (value: number) => formatNumber(value, preferences);
  const first = (page - 1) * DIRECTORY_PAGE_SIZE + 1;
  const last = Math.min(page * DIRECTORY_PAGE_SIZE, totalCount);
  const summary =
    pageCount <= 1
      ? singlePageCountText(format(totalCount))
      : pagedCountText(format(totalCount), format(first), format(last));
  return (
    <p
      aria-live="polite"
      aria-atomic="true"
      className="text-sm font-semibold text-muted-foreground tabular-nums"
    >
      {loading ? RESULT_COUNT_LOADING : summary}
    </p>
  );
}
