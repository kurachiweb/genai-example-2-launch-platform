import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';

import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { viewerQueryOptions } from '../../graphql/viewer.ts';

// メールのリンクの確定やプロフィールの保存はヘッダーなどが表示する利用者の情報を変えるため、利用者の取得を無効にし、ルートのbeforeLoadに取り直させる。操作は既に成功しているため、取り直しの失敗は投げずに成功の表示を続ける。GraphQLの想定外の失敗はexecuteGraphQLが送っているため、それ以外の例外だけをエラートラッキングへ送る
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
