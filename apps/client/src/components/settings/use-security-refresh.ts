import { useQueryClient } from '@tanstack/react-query';

import { useViewerRefresh } from '../auth/use-viewer-refresh.ts';
import { MY_SESSIONS_QUERY_PREFIX } from './my-sessions-query.ts';

// 多要素認証の変更は全端末のセッションを入れ替え、利用者の多要素認証の状態も変えるため、セッションの一覧と利用者の両方を取り直す
export function useSecurityRefresh(): () => Promise<void> {
  const queryClient = useQueryClient();
  const refreshViewer = useViewerRefresh();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: MY_SESSIONS_QUERY_PREFIX,
      }),
      refreshViewer(),
    ]);
  };
}
