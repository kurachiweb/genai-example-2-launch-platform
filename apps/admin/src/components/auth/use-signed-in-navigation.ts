import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { adminViewerQueryOptions } from '../../graphql/admin-viewer.ts';

// ログインの画面にはログイン中ならダッシュボードへ移すbeforeLoadがあり、取り直しを今の画面で走らせると戻り先へ移れないため、取得を無効にするだけにして、移動先のルートのbeforeLoadに取り直させる。ログインの画面は履歴に残さない
export function useSignedInNavigation(): (to: string) => Promise<void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async (to) => {
    await queryClient.invalidateQueries({
      queryKey: adminViewerQueryOptions().queryKey,
    });
    await navigate({ to: '.', href: to, replace: true });
  };
}
