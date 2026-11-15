import { Outlet, useRouteContext } from '@tanstack/react-router';

import { AdminViewerProvider } from '../layout/admin-viewer-context.tsx';

// ログイン必須の経路の無いレイアウトの部品。beforeLoadの判定を通った管理者を文脈から受け取り、子のページの部品へ配る
export function AuthenticatedLayout() {
  const { viewer } = useRouteContext({ strict: false });
  if (viewer === undefined || viewer === null) {
    throw new Error('ログイン必須の領域の文脈に管理者がありません。');
  }
  return (
    <AdminViewerProvider viewer={viewer}>
      <Outlet />
    </AdminViewerProvider>
  );
}
