export interface MemberInquiryPurgeBatchResult {
  readonly hasMore: boolean;
}

export interface MemberInquiryPurgeStore {
  // 論理削除の有無によらず、利用者のログインの問い合わせをIDの昇順にlimit件まで選び、添付の紐付け・メッセージ・問い合わせを1つの一括の書き込みで物理削除する。消した後に問い合わせが残っていればhasMoreが真
  purgeBatch(
    userId: string,
    limit: number,
  ): Promise<MemberInquiryPurgeBatchResult>;
}
