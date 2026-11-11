export interface HelpAuthorView {
  readonly nickname: string;
  readonly title: string | null;
  readonly avatarFileId: string | null;
}

export interface HelpAuthorLookup {
  // 結果に含まれないIDは削除済みの管理者とする。照会の例外は空の結果とwarnのログにする
  find(
    adminIds: readonly string[],
  ): Promise<ReadonlyMap<string, HelpAuthorView>>;
}
