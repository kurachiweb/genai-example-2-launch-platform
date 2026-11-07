export interface UltrasAccountDataEraser {
  // 利用者を参照するメールの依頼・加入が有効になった知らせ・加入の行の削除を1回の一括の書き込みで確定し、利用者の行の物理削除が外部キーの違反で失敗しないようにする。行が無ければ何もしない
  erase(userId: string): Promise<void>;
}
