// 主体ごとの送信回数の制限はカウンタの規則の名前だけを分け、時間窓と上限はこれを読んで主体の間でそろえる
export const MAIL_SEND_POLICY = Object.freeze({
  windowSeconds: 60 * 60,
  limitPerAddress: 3,
  limitPerIp: 5,
} as const);
