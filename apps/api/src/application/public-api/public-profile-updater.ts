import { inject, injectable } from 'inversify';

import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import type { WebsiteInput } from '../../domain/profile/website-list.ts';
import type { MyProfileReader } from '../profile/my-profile-reader.ts';
import type { MyProfileView } from '../profile/ports.ts';
import type {
  ProfileEditor,
  ProfileUpdateInput,
} from '../profile/profile-editor.ts';
import { PROFILE_TYPES } from '../profile/profile-types.ts';

// 指定の無い項目(undefined)は変えない。ヘッドラインと自己紹介のnullは値を消す指定である
export interface PublicProfilePatch {
  readonly nickname?: string;
  readonly handle?: string;
  readonly headline?: string | null;
  readonly bioMarkdown?: string | null;
  readonly websites?: readonly WebsiteInput[];
}

export interface PublicProfileUpdater {
  update(user: CurrentUser, patch: PublicProfilePatch): Promise<MyProfileView>;
}

// プロフィールの保存は全項目を求めるため、指定の無い項目を現在の値で埋める。公開APIは画像を受け付けないため画像は常に現在の値を保ち、保存の間の変更の検出には読んだ時点のハンドルを使う
export function composeProfileUpdate(
  current: MyProfileView,
  patch: PublicProfilePatch,
): ProfileUpdateInput {
  return {
    nickname: patch.nickname ?? current.nickname,
    handle: patch.handle ?? current.handle,
    expectedHandle: current.handle,
    headline: patch.headline === undefined ? current.headline : patch.headline,
    bioMarkdown:
      patch.bioMarkdown === undefined ? current.bioMarkdown : patch.bioMarkdown,
    avatarFileId: current.avatarFileId,
    websites: patch.websites ?? current.websites,
  };
}

// bot判定はGraphQLのリゾルバ側にあり、プロフィールの保存は求めないため、公開APIはbot判定なしで画面と同じ保存の条件を使う
@injectable()
export class EditorPublicProfileUpdater implements PublicProfileUpdater {
  constructor(
    @inject(PROFILE_TYPES.MyProfileReader)
    private readonly reader: MyProfileReader,
    @inject(PROFILE_TYPES.ProfileEditor)
    private readonly editor: ProfileEditor,
  ) {}

  async update(
    user: CurrentUser,
    patch: PublicProfilePatch,
  ): Promise<MyProfileView> {
    const current = await this.reader.read(user);
    return this.editor.update(user, composeProfileUpdate(current, patch));
  }
}
