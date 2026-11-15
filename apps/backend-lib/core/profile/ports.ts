export interface UserSummaryRecord {
  readonly userId: string;
  readonly handle: string;
  readonly nickname: string;
  readonly avatarFileId: string | null;
  readonly suspended: boolean;
}

// visible: 可視の利用者だけ / not-withdrawn: 停止中を含む / including-withdrawn: 停止中と退会済み(物理削除前)を含む
export type UserLookupScope =
  'visible' | 'not-withdrawn' | 'including-withdrawn';

export type UserHandleResolution =
  | { readonly kind: 'current'; readonly user: UserSummaryRecord }
  // user.handleは現在のハンドルで、呼び出し元はこれを転送先にする
  | { readonly kind: 'previous'; readonly user: UserSummaryRecord }
  | { readonly kind: 'none' };

export interface UserProfileDirectory {
  // 退会済みの利用者はincluding-withdrawnのときだけ返す。物理削除済みの利用者は行が無いため返らない
  findSummaries(
    userIds: readonly string[],
    scope: UserLookupScope,
  ): Promise<ReadonlyMap<string, UserSummaryRecord>>;
  // 退会済みの利用者は解決しない。停止中の利用者は返す
  resolveHandle(handle: string): Promise<UserHandleResolution>;
}

export interface ProfileExportRecord {
  readonly handle: string;
  readonly nickname: string;
  readonly headline: string | null;
  // 空ならdata-exportがprofile/bio.mdを書かない
  readonly bioMarkdown: string | null;
  // data-exportがmedia-pipelineで元のファイル名・隔離・実体を引く
  readonly avatarFileId: string | null;
  // 名前が未入力なら空文字列
  readonly websites: readonly {
    readonly name: string;
    readonly url: string;
  }[];
  // プロフィールの最終更新。プロフィールの行が無ければ利用者の登録日時
  readonly updatedAt: Date;
}

export interface ProfileExport {
  // 退会済み・物理削除済みはundefined。停止中は返す
  find(userId: string): Promise<ProfileExportRecord | undefined>;
}

export interface FollowExportEntry {
  readonly handle: string;
  readonly nickname: string;
  readonly followedAt: Date;
}

export interface FollowExport {
  // 可視の相手だけを、フォローした日時の新しい順に返す。フォロワーは返さない
  listFollowing(userId: string): Promise<readonly FollowExportEntry[]>;
}

export interface FollowerDirectory {
  // フォローのIDの昇順で可視のフォロワーを返す。受信設定とメールアドレスの確認の判定は通知の側で行う
  listVisibleFollowerIds(input: {
    // 直前のページの最後のフォローのID
    readonly after: string | undefined;
    readonly followeeId: string;
    // 1〜500
    readonly limit: number;
  }): Promise<{
    readonly followerIds: readonly string[];
    readonly next: string | undefined;
  }>;
}
