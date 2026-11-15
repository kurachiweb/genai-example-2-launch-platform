import { inject, injectable } from 'inversify';

import {
  isReservedHandle,
  isSameHandle,
} from '../../../common-lib/handles/handle-rules.ts';
import {
  USER_AVATAR_PURPOSE,
  USER_HANDLE_RULE,
} from '../../../common-lib/profile/profile-input-rules.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { MEDIA_TYPES } from '../../../lib/core/media/identifiers.ts';
import type { MediaFiles } from '../../../lib/core/media/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import {
  type ProfileEditPlan,
  planProfileEdit,
} from '../../domain/profile/profile-edit-plan.ts';
import {
  normalizeWebsites,
  type WebsiteInput,
} from '../../domain/profile/website-list.ts';
import { toMyProfileView } from './my-profile-reader.ts';
import type {
  MyProfileView,
  ProfileSaveResult,
  ProfileSnapshot,
  ProfileStore,
} from './ports.ts';
import { profileError } from './profile-errors.ts';
import { PROFILE_TYPES } from './profile-types.ts';

export interface ProfileUpdateInput {
  readonly nickname: string;
  readonly handle: string;
  // 画面を開いた時点のハンドル。保存の間に変更されたことの検出に使う
  readonly expectedHandle: string;
  readonly headline: string | null;
  readonly bioMarkdown: string | null;
  // 保存後の状態。現在のIDなら維持し、nullなら削除する
  readonly avatarFileId: string | null;
  readonly websites: readonly WebsiteInput[];
}

export interface ProfileEditor {
  update(user: CurrentUser, input: ProfileUpdateInput): Promise<MyProfileView>;
}

const logger = getAppLogger(['api', 'application', 'profile']);

const SAVE_FAILURES = {
  'handle-unavailable': 'handle_unavailable',
  conflict: 'profile_update_conflict',
  'account-unavailable': 'account_unavailable',
} as const satisfies Readonly<
  Record<Exclude<ProfileSaveResult, 'saved'>, string>
>;

// 本人が保持している旧ハンドルへの戻しは、他人に使われていないことを保存の一括の書き込みが確かめるため、ここでは予約語にも使用中にも当てはめない
const requiresAvailabilityCheck = (
  plan: ProfileEditPlan,
  snapshot: ProfileSnapshot,
): plan is ProfileEditPlan & {
  readonly handle: { readonly kind: 'changed'; readonly next: string };
} =>
  plan.handle.kind === 'changed' &&
  !(
    snapshot.previousHandle !== null &&
    isSameHandle(snapshot.previousHandle, plan.handle.next)
  );

@injectable()
export class StoreProfileEditor implements ProfileEditor {
  constructor(
    @inject(PROFILE_TYPES.ProfileStore)
    private readonly store: ProfileStore,
    @inject(MEDIA_TYPES.MediaFiles) private readonly media: MediaFiles,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async update(
    user: CurrentUser,
    input: ProfileUpdateInput,
  ): Promise<MyProfileView> {
    const userId = user.user.id;
    const snapshot = await this.store.findSnapshot(userId);
    if (snapshot === undefined) {
      throw profileError('account_unavailable');
    }
    if (snapshot.handle !== input.expectedHandle) {
      throw profileError('profile_update_conflict');
    }
    const plan = planProfileEdit(
      { handle: snapshot.handle, avatarFileId: snapshot.avatarFileId },
      { handle: input.handle, avatarFileId: input.avatarFileId },
    );
    if (requiresAvailabilityCheck(plan, snapshot)) {
      await this.#assertHandleAvailable(userId, plan.handle.next);
    }
    if (plan.avatar.kind === 'set') {
      await this.#claimAvatar(userId, plan.avatar.fileId);
    }
    const saved = await this.store.save({
      userId,
      expectedHandle: snapshot.handle,
      nickname: input.nickname,
      plan,
      handle: input.handle,
      headline: input.headline,
      bioMarkdown: input.bioMarkdown,
      avatarFileId: input.avatarFileId,
      websites: normalizeWebsites(input.websites),
      now: this.clock.now(),
    });
    if (saved !== 'saved') {
      throw profileError(SAVE_FAILURES[saved]);
    }
    await this.#discardPreviousAvatar(plan);
    const updated = await this.store.findSnapshot(userId);
    if (updated === undefined) {
      throw profileError('account_unavailable');
    }
    return toMyProfileView(updated);
  }

  async #assertHandleAvailable(userId: string, handle: string): Promise<void> {
    if (isReservedHandle(handle, USER_HANDLE_RULE)) {
      throw profileError('handle_unavailable');
    }
    const occupied = await this.store.isHandleOccupied(handle, {
      exceptUserId: userId,
    });
    if (occupied) {
      throw profileError('handle_unavailable');
    }
  }

  async #claimAvatar(userId: string, fileId: string): Promise<void> {
    const claimed = await this.media.claim({
      fileIds: [fileId],
      purpose: USER_AVATAR_PURPOSE,
      owner: { kind: 'user', id: userId },
    });
    if (!claimed.ok) {
      throw profileError('invalid_upload');
    }
  }

  // 保存を確定した後の後始末のため、失敗しても保存の結果を変えない。物理削除はmedia-pipelineの日次のバッチが完了させる
  async #discardPreviousAvatar(plan: ProfileEditPlan): Promise<void> {
    const { avatar } = plan;
    const operation =
      avatar.kind === 'set' && avatar.replaced !== null
        ? { fileId: avatar.replaced, erase: true }
        : avatar.kind === 'remove'
          ? { fileId: avatar.removed, erase: false }
          : undefined;
    if (operation === undefined) {
      return;
    }
    try {
      await (operation.erase
        ? this.media.eraseNow([operation.fileId])
        : this.media.markDeleted([operation.fileId]));
    } catch (error: unknown) {
      logger.warning('以前のプロフィール画像を削除できませんでした', {
        fileId: operation.fileId,
        error,
      });
    }
  }
}
