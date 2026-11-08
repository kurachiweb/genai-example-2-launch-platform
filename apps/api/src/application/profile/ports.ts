import type { ProfileEditPlan } from '../../domain/profile/profile-edit-plan.ts';
import type { NormalizedWebsite } from '../../domain/profile/website-list.ts';

export interface MyProfileView {
  readonly nickname: string;
  readonly handle: string;
  readonly previousHandle: string | null;
  readonly headline: string | null;
  readonly bioMarkdown: string | null;
  readonly avatarFileId: string | null;
  readonly websites: readonly NormalizedWebsite[];
  readonly suspended: boolean;
}

export interface ProfileSnapshot extends MyProfileView {
  readonly userId: string;
}

export type ProfileSaveResult =
  'saved' | 'handle-unavailable' | 'conflict' | 'account-unavailable';

export interface ProfileHandleOccupiedOptions {
  readonly exceptUserId?: string;
  readonly includePrevious?: boolean;
}

export interface ProfileSaveInput {
  readonly userId: string;
  readonly expectedHandle: string;
  readonly nickname: string;
  readonly plan: ProfileEditPlan;
  readonly handle: string;
  readonly headline: string | null;
  readonly bioMarkdown: string | null;
  readonly avatarFileId: string | null;
  readonly websites: readonly NormalizedWebsite[];
  readonly now: Date;
}

export interface ProfileStore {
  findSnapshot(userId: string): Promise<ProfileSnapshot | undefined>;
  isHandleOccupied(
    handle: string,
    options?: ProfileHandleOccupiedOptions,
  ): Promise<boolean>;
  findExistingUserIds(userIds: readonly string[]): Promise<ReadonlySet<string>>;
  save(input: ProfileSaveInput): Promise<ProfileSaveResult>;
}

export interface PublicProfileRecord {
  readonly handle: string;
  readonly nickname: string;
  readonly headline: string | null;
  readonly bioMarkdown: string | null;
  readonly avatarFileId: string | null;
  readonly websites: readonly {
    readonly name: string | null;
    readonly url: string;
  }[];
  // 停止中のフォロワーを除いた数
  readonly followerCount: number;
  readonly suspended: boolean;
  readonly viewerFollows: boolean;
}

export interface PublicProfileStore {
  // 退会済みの利用者と存在しない利用者はundefined。停止中は返し、公開してよいかの判断は呼び出し側で行う
  load(
    userId: string,
    viewerUserId: string | undefined,
  ): Promise<PublicProfileRecord | undefined>;
}
