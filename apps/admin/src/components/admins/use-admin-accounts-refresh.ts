import { useQueryClient } from '@tanstack/react-query';

import { documentIdOf } from '../../../lib/utilities/graphql/persisted-document.ts';
import { invalidateAuditLogQueries } from '../../graphql/admin-audit-logs.ts';
import { AdminAccountsDocument } from '../../graphql/generated/graphql.ts';

export interface AdminAccountsRefreshOptions {
  // 変更が監査ログに残る操作(招待・再送・削除・ロールの変更)か
  readonly audited: boolean;
}

// 変更の後に一覧の取得を無効にし、表示中の一覧を取り直させる。監査ログに残る変更は監査ログの照会も無効にする。取り直しの失敗は表示中の一覧を残し、変更の成功の表示を続ける
export function useAdminAccountsRefresh({
  audited,
}: AdminAccountsRefreshOptions): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: [documentIdOf(AdminAccountsDocument)],
      }),
      ...(audited ? [invalidateAuditLogQueries(queryClient)] : []),
    ]);
  };
}
