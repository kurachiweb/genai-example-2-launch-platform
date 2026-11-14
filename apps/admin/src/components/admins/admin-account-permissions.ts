import {
  type AdminRole,
  hasRole,
} from '../../../common-lib/admin/admin-roles.ts';
import type { AdminAccountStatus } from '../../graphql/admin-accounts.ts';

export interface AdminAccountOperator {
  readonly id: string;
  readonly role: AdminRole;
}

export interface AdminAccountTarget {
  readonly id: string;
  readonly role: AdminRole;
  readonly status: AdminAccountStatus;
}

export interface AdminAccountActions {
  readonly resend: boolean;
  readonly changeRole: boolean;
  readonly editProfile: boolean;
  readonly delete: boolean;
}

export const canInviteAdmins = (role: AdminRole): boolean =>
  hasRole(role, 'moderator');

// APIサーバーのドメインの規則(削除は自分自身→ロール不足→最上位管理者が対象の順)と同じ判定で、拒否される操作を描かない。最後の最上位管理者の保護は他の管理者の状態に依るため、APIサーバーの拒否の文言で示す
const canDelete = (
  operator: AdminAccountOperator,
  target: AdminAccountTarget,
): boolean =>
  operator.id !== target.id &&
  hasRole(operator.role, 'moderator') &&
  (target.role !== 'super_admin' || operator.role === 'super_admin');

// 自分のプロフィールは自分のアカウントのページで編集し、招待の完了前の管理者のニックネームは本人が招待の完了で決める
const canEditProfile = (
  operator: AdminAccountOperator,
  target: AdminAccountTarget,
): boolean =>
  operator.id !== target.id &&
  target.status === 'active' &&
  hasRole(operator.role, 'super_admin');

export const accountActionsOf = (
  operator: AdminAccountOperator,
  target: AdminAccountTarget,
): AdminAccountActions => ({
  resend: target.status !== 'active' && canInviteAdmins(operator.role),
  changeRole: hasRole(operator.role, 'super_admin'),
  editProfile: canEditProfile(operator, target),
  delete: canDelete(operator, target),
});
