import type { ReactNode } from 'react';

import {
  type AdminRole,
  hasRole,
} from '../../../common-lib/admin/admin-roles.ts';
import { useAdminRole } from './use-current-admin.ts';

export interface RoleGateProps {
  readonly minimum: AdminRole;
  // 権限が無いときに代わりに描く内容。既定は何も描かない
  readonly fallback?: ReactNode;
  readonly children: ReactNode;
}

export function RoleGate({
  minimum,
  fallback = null,
  children,
}: RoleGateProps) {
  return hasRole(useAdminRole(), minimum) ? children : fallback;
}
