import { createContext, use } from 'react';

import type { AdminRole } from '../../../common-lib/admin/admin-roles.ts';
import type { AdminViewer } from '../../graphql/admin-viewer.ts';

export const AdminViewerContext = createContext<AdminViewer | null>(null);

export function useCurrentAdmin(): AdminViewer {
  const viewer = use(AdminViewerContext);
  if (viewer === null) {
    throw new Error(
      'ログイン中の管理者はログイン必須の領域(AdminViewerProvider)の内側で読んでください。',
    );
  }
  return viewer;
}

export const useAdminRole = (): AdminRole => useCurrentAdmin().role;
