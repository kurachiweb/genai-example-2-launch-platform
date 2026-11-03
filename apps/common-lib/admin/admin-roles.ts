export type AdminRole = 'viewer' | 'moderator' | 'super_admin';

export const ADMIN_ROLES: readonly AdminRole[] = Object.freeze([
  'viewer',
  'moderator',
  'super_admin',
]);

export const hasRole = (actual: AdminRole, minimum: AdminRole): boolean =>
  ADMIN_ROLES.indexOf(actual) >= ADMIN_ROLES.indexOf(minimum);

export const ADMIN_ROLE_LABELS: Readonly<Record<AdminRole, string>> =
  Object.freeze({
    viewer: '閲覧のみ',
    moderator: 'モデレーター',
    super_admin: '最上位管理者',
  });
