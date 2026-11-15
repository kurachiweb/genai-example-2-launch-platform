import { createFileRoute } from '@tanstack/react-router';

import { AuthenticatedLayout } from '../../components/auth/authenticated-layout.tsx';
import { requireAdminViewer } from '../../components/auth/require-admin-viewer.ts';

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: requireAdminViewer,
  component: AuthenticatedLayout,
});
