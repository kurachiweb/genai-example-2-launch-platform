export interface PaymentAccountDataEraser {
  // 外部キーの順(返金の依頼→購入→Customerの対応)の利用者の行の削除を1回の一括の書き込みで確定する。決済履歴は仮名化IDだけを持つため消さない。行が無ければ何もしない
  erase(userId: string): Promise<void>;
}
