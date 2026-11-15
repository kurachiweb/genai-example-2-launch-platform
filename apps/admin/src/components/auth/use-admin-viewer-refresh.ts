import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';

import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { adminViewerQueryOptions } from '../../graphql/admin-viewer.ts';

// ログアウト・メールのリンクの確定・セッションの入れ替えの後に、管理者の取得を無効にし、ルートのbeforeLoadに取り直させる。操作は済んでいるため、取り直しの失敗は投げずに操作の成功の表示を続ける。GraphQLの想定外の失敗はexecuteGraphQLが送っているため、それ以外の例外だけをエラートラッキングへ送る
export function useAdminViewerRefresh(): () => Promise<void> {
  const queryClient = useQueryClient();
  const router = useRouter();
  return async () => {
    try {
      await queryClient.invalidateQueries({
        queryKey: adminViewerQueryOptions().queryKey,
      });
      await router.invalidate();
    } catch (error) {
      if (!(error instanceof GraphQLClientError)) {
        reportUnexpectedErrorInBrowser(error, 'render');
      }
    }
  };
}
