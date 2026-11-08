export const PROFILE_TYPE_DEFS = /* GraphQL */ `
  "他の利用者の表示に使う最小限の情報。他の機能の型が利用者を指す項目の戻り値に使う"
  type UserSummary {
    handle: String!
    nickname: String!
    "プロフィール画像。未設定ならnull。隔離中の画像は枠だけを返し、objectKeyが空になる"
    avatar: MediaImage
  }
`;
