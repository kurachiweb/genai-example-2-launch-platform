import {
  type AdminRole,
  hasRole,
} from '../../../common-lib/admin/admin-roles.ts';

export const ADMIN_STATUSES = Object.freeze(['invited', 'active'] as const);

export type AdminStatus = (typeof ADMIN_STATUSES)[number];

export interface AdminSnapshot {
  readonly id: string;
  readonly role: AdminRole;
  readonly status: AdminStatus;
  readonly invitationExpiresAt: Date | null;
}

export type AdminDisplayStatus = 'active' | 'invited' | 'invitation_expired';

export type AdminOperationDenial =
  'insufficient_role' | 'self' | 'super_admin_target';

export const displayStatus = (
  admin: AdminSnapshot,
  now: Date,
): AdminDisplayStatus => {
  if (admin.status === 'active') {
    return 'active';
  }
  if (
    admin.invitationExpiresAt !== null &&
    now.getTime() >= admin.invitationExpiresAt.getTime()
  ) {
    return 'invitation_expired';
  }
  return 'invited';
};

const requireRole = (
  operator: AdminSnapshot,
  minimum: AdminRole,
): AdminOperationDenial | undefined =>
  hasRole(operator.role, minimum) ? undefined : 'insufficient_role';

export const checkDeletable = (
  operator: AdminSnapshot,
  target: AdminSnapshot,
): AdminOperationDenial | undefined => {
  if (operator.id === target.id) {
    return 'self';
  }
  const roleDenial = requireRole(operator, 'moderator');
  if (roleDenial !== undefined) {
    return roleDenial;
  }
  if (target.role === 'super_admin' && operator.role !== 'super_admin') {
    return 'super_admin_target';
  }
  return undefined;
};

export const checkRoleChangeable = (
  operator: AdminSnapshot,
): AdminOperationDenial | undefined => requireRole(operator, 'super_admin');

export const checkProfileEditable = (
  operator: AdminSnapshot,
  targetId: string,
): AdminOperationDenial | undefined =>
  operator.id === targetId ? undefined : requireRole(operator, 'super_admin');

export const checkInvitable = (
  operator: AdminSnapshot,
): AdminOperationDenial | undefined => requireRole(operator, 'moderator');
