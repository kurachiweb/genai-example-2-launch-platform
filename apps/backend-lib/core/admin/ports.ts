export interface AdminProfileView {
  readonly id: string;
  readonly nickname: string;
  readonly title: string | null;
  readonly avatarFileId: string | null;
}

export interface AdminDirectory {
  // 有効な管理者だけを含めるため、削除済み・招待中・存在しないIDは結果に無い
  findProfiles(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, AdminProfileView>>;
}
