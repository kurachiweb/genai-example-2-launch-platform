import { LIVE_REFRESH_QUERY_OPTIONS } from '../../../lib/utilities/query/live-refresh.ts';
import type { MyDataExportsData } from '../../graphql/data-export.ts';
import type { DataExportFieldsFragment } from '../../graphql/generated/graphql.ts';

export const toDataExports = (
  data: MyDataExportsData,
): readonly DataExportFieldsFragment[] =>
  data.pages.flatMap(({ myDataExports }) => myDataExports.nodes);

export const hasPendingDataExport = (
  data: MyDataExportsData | undefined,
): boolean =>
  data !== undefined &&
  toDataExports(data).some(({ status }) => status === 'PENDING');

interface RefetchIntervalQuery {
  readonly state: { readonly data: MyDataExportsData | undefined };
}

// 作成中の要求はサーバーの非同期の処理の完了で状態が変わるため、作成中が1件でもある間だけ取り直す。判定は選択する前の取得の値で行う
export const dataExportRefetchInterval =
  (autoRefresh: boolean) =>
  (query: RefetchIntervalQuery): number | false =>
    autoRefresh && hasPendingDataExport(query.state.data)
      ? LIVE_REFRESH_QUERY_OPTIONS.refetchInterval
      : false;
