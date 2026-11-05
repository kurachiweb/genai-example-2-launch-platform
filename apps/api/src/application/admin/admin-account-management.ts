import { inject, injectable } from 'inversify';

import type { AdminRole } from '../../../common-lib/admin/admin-roles.ts';
import {
  ADMIN_ACCOUNT_DELETE_ACTION,
  ADMIN_ACCOUNT_ROLE_CHANGE_ACTION,
} from '../../../common-lib/admin/audit-actions/admin-foundation.ts';
import type { AuditLogRecorder } from '../../../lib/core/admin/audit-log.ts';
import type { CurrentAdmin } from '../../../lib/core/admin/current-admin.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import type { AppError } from '../../../lib/core/errors/app-error.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { MEDIA_TYPES } from '../../../lib/core/media/identifiers.ts';
import type { MediaFiles } from '../../../lib/core/media/ports.ts';
import {
  type AdminDisplayStatus,
  checkDeletable,
  checkRoleChangeable,
  displayStatus,
} from '../../domain/admin/admin-account.ts';
import { operatorSnapshotOf } from './admin-authorizer.ts';
import { adminError } from './admin-errors.ts';
import { ADMIN_TYPES } from './admin-types.ts';
import type {
  AdminAccountStore,
  AdminRecord,
  AdminRequestMeta,
} from './ports.ts';

export interface AdminAccountView {
  readonly id: string;
  readonly email: string;
  readonly nickname: string | null;
  readonly title: string | null;
  readonly avatarFileId: string | null;
  readonly role: AdminRole;
  readonly status: AdminDisplayStatus;
  readonly createdAt: Date;
}

export interface AdminDeletionInput {
  readonly adminId: string;
  readonly reason?: string;
}

export interface AdminRoleChangeInput {
  readonly adminId: string;
  readonly role: AdminRole;
  readonly reason?: string;
}

export interface AdminAccountManagement {
  // 招待中を含む全管理者を登録の新しい順に返す
  list(
    current: CurrentAdmin,
    meta: AdminRequestMeta,
  ): Promise<readonly AdminAccountView[]>;
  delete(
    current: CurrentAdmin,
    input: AdminDeletionInput,
    meta: AdminRequestMeta,
  ): Promise<void>;
  changeRole(
    current: CurrentAdmin,
    input: AdminRoleChangeInput,
    meta: AdminRequestMeta,
  ): Promise<AdminAccountView>;
}

const logger = getAppLogger(['api', 'admin', 'account']);

export const toAdminAccountView = (
  admin: AdminRecord,
  now: Date,
): AdminAccountView => ({
  id: admin.id,
  email: admin.email,
  nickname: admin.nickname,
  title: admin.title,
  avatarFileId: admin.avatarFileId,
  role: admin.role,
  status: displayStatus(admin, now),
  createdAt: admin.createdAt,
});

const isActiveSuperAdmin = (admin: AdminRecord): boolean =>
  admin.role === 'super_admin' && admin.status === 'active';

// 即時の削除に失敗しても削除待ちの印から日次のバッチが物理削除を完了させるため、書き込みを終えた管理操作を失敗させない
export async function eraseAvatarQuietly(
  media: MediaFiles,
  adminId: string,
  fileId: string,
  log: typeof logger,
): Promise<void> {
  try {
    await media.eraseNow([fileId]);
  } catch (error) {
    log.warning('管理者のプロフィール画像を即時に削除できませんでした', {
      adminId,
      error,
    });
  }
}

@injectable()
export class StoreAdminAccountManagement implements AdminAccountManagement {
  constructor(
    @inject(ADMIN_TYPES.AdminAccountStore)
    private readonly admins: AdminAccountStore,
    @inject(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
    private readonly auditLog: AuditLogRecorder,
    @inject(MEDIA_TYPES.MediaFiles)
    private readonly media: MediaFiles,
  ) {}

  async list(
    _current: CurrentAdmin,
    meta: AdminRequestMeta,
  ): Promise<readonly AdminAccountView[]> {
    const admins = await this.admins.list();
    return admins.map((admin) => toAdminAccountView(admin, meta.now));
  }

  async delete(
    current: CurrentAdmin,
    input: AdminDeletionInput,
    meta: AdminRequestMeta,
  ): Promise<void> {
    const operator = operatorSnapshotOf(current);
    if (input.adminId === current.id) {
      throw adminError('self_deletion_forbidden');
    }
    const target = await this.#requireTarget(input.adminId);
    if (checkDeletable(operator, target) !== undefined) {
      throw adminError('forbidden');
    }
    const audit = this.auditLog.prepare({
      operatorAdminId: current.id,
      action: ADMIN_ACCOUNT_DELETE_ACTION.name,
      targetIds: [target.id],
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      occurredAt: meta.now,
    });
    const deleted = await this.admins.deleteGuarded(operator, target.id, audit);
    if (deleted === 'rejected') {
      throw await this.#rejectionOf(target.id, isActiveSuperAdmin);
    }
    if (target.avatarFileId !== null) {
      await eraseAvatarQuietly(
        this.media,
        target.id,
        target.avatarFileId,
        logger,
      );
    }
  }

  async changeRole(
    current: CurrentAdmin,
    input: AdminRoleChangeInput,
    meta: AdminRequestMeta,
  ): Promise<AdminAccountView> {
    const operator = operatorSnapshotOf(current);
    if (checkRoleChangeable(operator) !== undefined) {
      throw adminError('forbidden');
    }
    const target = await this.#requireTarget(input.adminId);
    const change = {
      targetId: target.id,
      fromRole: target.role,
      toRole: input.role,
    };
    const audit = this.auditLog.prepare({
      operatorAdminId: current.id,
      action: ADMIN_ACCOUNT_ROLE_CHANGE_ACTION.name,
      targetIds: [target.id],
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      detail: { fromRole: change.fromRole, toRole: change.toRole },
      occurredAt: meta.now,
    });
    const changed = await this.admins.changeRoleGuarded(
      operator,
      change,
      audit,
    );
    if (changed === 'rejected') {
      throw await this.#rejectionOf(
        target.id,
        (latest) => isActiveSuperAdmin(latest) && input.role !== 'super_admin',
      );
    }
    return toAdminAccountView({ ...target, role: input.role }, meta.now);
  }

  async #requireTarget(adminId: string): Promise<AdminRecord> {
    const target = await this.admins.findById(adminId);
    if (target === undefined) {
      throw adminError('not_found');
    }
    return target;
  }

  // 一括の書き込みは条件のどれで取り消されたかを返さないため、書き込みの後の状態を読み直して理由を判別する
  async #rejectionOf(
    targetId: string,
    losesSuperAdmin: (latest: AdminRecord) => boolean,
  ): Promise<AppError> {
    const latest = await this.admins.findById(targetId);
    if (latest === undefined) {
      return adminError('not_found');
    }
    if (losesSuperAdmin(latest) && (await this.#isLastSuperAdmin(latest))) {
      return adminError('last_super_admin');
    }
    return adminError('admin_state_conflict');
  }

  async #isLastSuperAdmin(target: AdminRecord): Promise<boolean> {
    const admins = await this.admins.list();
    return !admins.some(
      (admin) => admin.id !== target.id && isActiveSuperAdmin(admin),
    );
  }
}
