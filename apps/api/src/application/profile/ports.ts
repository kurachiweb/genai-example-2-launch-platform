import type { UserSummaryRecord } from '../../../lib/core/profile/ports.ts';
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

export type FollowDirection = 'following' | 'followers';

export interface FollowListPosition {
  // フォローの作成日時のミリ秒
  readonly t: number;
  // フォローのID
  readonly id: string;
}

export interface FollowEntryView {
  readonly followId: string;
  readonly user: UserSummaryRecord;
  readonly followedAt: Date;
}

export interface FollowInsertInput {
  readonly id: string;
  readonly followerId: string;
  readonly followeeId: string;
  readonly now: Date;
}

export interface FollowListQuery {
  readonly userId: string;
  readonly direction: FollowDirection;
  readonly first: number;
  readonly after: FollowListPosition | undefined;
}

export interface FollowStore {
  // 相手が可視のときだけ記録する。論理削除済みの行がある組は記録せず、相手が使えないものとして扱う
  insertIfAbsent(
    input: FollowInsertInput,
  ): Promise<'inserted' | 'exists' | 'target-unavailable'>;
  // 物理削除。行が無くても成功する
  delete(followerId: string, followeeId: string): Promise<void>;
  isFollowing(followerId: string, followeeId: string): Promise<boolean>;
  countVisibleFollowers(followeeId: string): Promise<number>;
  // 作成日時とIDの新しい順に、位置より後(古い側)の可視の相手をfirst+1件まで返す。first+1件目は続きの有無の判定だけに使う
  list(query: FollowListQuery): Promise<readonly FollowEntryView[]>;
}
