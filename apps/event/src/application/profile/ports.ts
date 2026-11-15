export interface ProfilePurgeStore {
  // 本人がフォロワーの行と相手の行の両方を、論理削除済みの行も含めて最大limit件まで物理削除し、消した件数を返す
  deleteFollowsBatch(userId: string, limit: number): Promise<number>;
  // 外部Webサイト・旧ハンドル・プロフィールの行を1つの一括の書き込みで物理削除する。行が無ければ何もしない
  deleteProfileRows(userId: string): Promise<void>;
}
