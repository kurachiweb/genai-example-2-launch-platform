import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';

import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { viewerQueryOptions } from '../../graphql/viewer.ts';

// メールのリンクの確定はセッションを消すか入れ替えるため、利用者の取得を無効にし、ルートのbeforeLoadに取り直させる。確定は済んでおりトークンも使用済みのため、取り直しの失敗は投げずに確定の成功の表示を続ける。GraphQLの想定外の失敗はexecuteGraphQLが送っているため、それ以外の例外だけをエラートラッキングへ送る
export function useViewerRefresh(): () => Promise<void> {
  const queryClient = useQueryClient();
  const router = useRouter();
  return async () => {
    try {
      await queryClient.invalidateQueries({
        queryKey: viewerQueryOptions().queryKey,
      });
      await router.invalidate();
    } catch (error) {
      if (!(error instanceof GraphQLClientError)) {
        reportUnexpectedErrorInBrowser(error, 'render');
      }
    }
  };
}
