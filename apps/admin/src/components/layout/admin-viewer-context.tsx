import type { ReactNode } from 'react';

import type { AdminViewer } from '../../graphql/admin-viewer.ts';
import { AdminViewerContext } from './use-current-admin.ts';

export interface AdminViewerProviderProps {
  readonly viewer: AdminViewer;
  readonly children: ReactNode;
}

export function AdminViewerProvider({
  viewer,
  children,
}: AdminViewerProviderProps) {
  return <AdminViewerContext value={viewer}>{children}</AdminViewerContext>;
}
