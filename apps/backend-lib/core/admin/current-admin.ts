import type { AdminRole } from '../../../common-lib/admin/admin-roles.ts';

export interface CurrentAdmin {
  readonly id: string;
  readonly role: AdminRole;
  readonly nickname: string;
  readonly sessionId: string;
}
