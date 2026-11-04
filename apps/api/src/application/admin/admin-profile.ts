import { inject, injectable } from 'inversify';

import { ADMIN_AVATAR_UPLOAD_PURPOSE } from '../../../common-lib/admin/admin-avatar-upload.ts';
import {
  checkAdminNickname,
  checkAdminTitle,
} from '../../../common-lib/admin/admin-input-rules.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { MEDIA_TYPES } from '../../../lib/core/media/identifiers.ts';
import type { MediaFiles } from '../../../lib/core/media/ports.ts';
import { checkProfileEditable } from '../../domain/admin/admin-account.ts';
import {
  type AdminAccountView,
  eraseAvatarQuietly,
  toAdminAccountView,
} from './admin-account-management.ts';
import { type CurrentAdmin, operatorSnapshotOf } from './admin-authorizer.ts';
import { adminError, adminProfileRejectedError } from './admin-errors.ts';
import { ADMIN_TYPES } from './admin-types.ts';
import type {
  AdminAccountStore,
  AdminProfileUpdate,
  AdminRecord,
  AdminRequestMeta,
} from './ports.ts';

export interface AdminProfileInput {
  readonly adminId: string;
  readonly nickname: string;
  // 未指定・空白だけは未設定
  readonly title?: string | null;
  // 未指定は画像を取り除く
  readonly avatarFileId?: string | null;
}

export interface AdminProfile {
  update(
    current: CurrentAdmin,
    input: AdminProfileInput,
    meta: AdminRequestMeta,
  ): Promise<AdminAccountView>;
}

const logger = getAppLogger(['api', 'admin', 'profile']);

function normalizeProfile(input: AdminProfileInput): AdminProfileUpdate {
  const nickname = checkAdminNickname(input.nickname);
  const title = input.title == null ? undefined : checkAdminTitle(input.title);
  if (nickname !== undefined || title !== undefined) {
    throw adminProfileRejectedError({ nickname, title });
  }
  const trimmedTitle = trimWhiteSpace(input.title ?? '');
  return {
    nickname: trimWhiteSpace(input.nickname),
    title: trimmedTitle === '' ? null : trimmedTitle,
    avatarFileId: input.avatarFileId ?? null,
  };
}

@injectable()
export class StoreAdminProfile implements AdminProfile {
  constructor(
    @inject(ADMIN_TYPES.AdminAccountStore)
    private readonly admins: AdminAccountStore,
    @inject(MEDIA_TYPES.MediaFiles)
    private readonly media: MediaFiles,
  ) {}

  async update(
    current: CurrentAdmin,
    input: AdminProfileInput,
    meta: AdminRequestMeta,
  ): Promise<AdminAccountView> {
    if (
      checkProfileEditable(operatorSnapshotOf(current), input.adminId) !==
      undefined
    ) {
      throw adminError('forbidden');
    }
    const profile = normalizeProfile(input);
    const target = await this.admins.findById(input.adminId);
    // 招待の完了前の管理者のニックネームは本人が招待の完了で決めるため、有効な管理者だけを編集の対象にする
    if (target?.status !== 'active') {
      throw adminError('not_found');
    }
    const previousAvatarId = target.avatarFileId;
    const claimedAvatarId =
      profile.avatarFileId !== null && profile.avatarFileId !== previousAvatarId
        ? profile.avatarFileId
        : undefined;
    if (claimedAvatarId !== undefined) {
      await this.#claimAvatar(current, claimedAvatarId);
    }
    const updated = await this.admins.updateProfile(target.id, profile);
    if (updated === 'not-active') {
      // 読み取った後に対象が削除されたため、どの行からも参照されない紐付けたばかりの画像を消す
      if (claimedAvatarId !== undefined) {
        await eraseAvatarQuietly(
          this.media,
          target.id,
          claimedAvatarId,
          logger,
        );
      }
      throw adminError('not_found');
    }
    // 保有者単位で削除すると操作者がアップロードした他の管理者の画像まで消えるため、行が参照していた画像だけを削除する
    if (
      previousAvatarId !== null &&
      previousAvatarId !== profile.avatarFileId
    ) {
      await eraseAvatarQuietly(this.media, target.id, previousAvatarId, logger);
    }
    return toAdminAccountView(updatedRecord(target, profile), meta.now);
  }

  // 他の管理者のプロフィールでも、アップロードしたのは操作者のため保有者を操作者にして照合する
  async #claimAvatar(current: CurrentAdmin, fileId: string): Promise<void> {
    const claimed = await this.media.claim({
      fileIds: [fileId],
      purpose: ADMIN_AVATAR_UPLOAD_PURPOSE,
      owner: { kind: 'admin', id: current.id },
    });
    if (!claimed.ok) {
      throw adminError('invalid_upload');
    }
  }
}

const updatedRecord = (
  target: AdminRecord,
  profile: AdminProfileUpdate,
): AdminRecord => ({ ...target, ...profile });
