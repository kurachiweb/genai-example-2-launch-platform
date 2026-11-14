import { useQueryClient } from '@tanstack/react-query';

import { documentIdOf } from '../../../lib/utilities/graphql/persisted-document.ts';
import { AdminAccountsDocument } from '../../graphql/generated/graphql.ts';

// 変更の後に一覧の取得を無効にし、表示中の一覧を取り直させる。取り直しの失敗は表示中の一覧を残し、変更の成功の表示を続ける
export function useAdminAccountsRefresh(): () => Promise<void> {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      queryKey: [documentIdOf(AdminAccountsDocument)],
    });
}
