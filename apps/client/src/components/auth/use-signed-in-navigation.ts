import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { viewerQueryOptions } from '../../graphql/viewer.ts';

// 移動先のルートのbeforeLoadがログイン中の利用者で判定できるよう、取得を無効にして取り直させてから移る。ログインの画面は履歴に残さない
export function useSignedInNavigation(): (to: string) => Promise<void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async (to) => {
    await queryClient.invalidateQueries({
      queryKey: viewerQueryOptions().queryKey,
    });
    await navigate({ to: '.', href: to, replace: true });
  };
}
