export const PROFILE_TYPE_DEFS = /* GraphQL */ `
  "他の利用者の表示に使う最小限の情報。他の機能の型が利用者を指す項目の戻り値に使う"
  type UserSummary {
    handle: String!
    nickname: String!
    "プロフィール画像。未設定ならnull。隔離中の画像は枠だけを返し、objectKeyが空になる"
    avatar: MediaImage
  }

  "ハンドルの使用可否。INVALIDは形式の違反"
  enum HandleAvailability {
    AVAILABLE
    UNAVAILABLE
    INVALID
  }

  "公開プロフィールの閲覧者と表示される利用者の関係"
  enum ProfileViewerRelation {
    OWNER
    FOLLOWING
    NOT_FOLLOWING
    GUEST
  }

  type ProfileWebsite {
    "未入力ならnull。画面はホスト名を表示する"
    name: String
    url: String!
  }

  type PublicProfile {
    handle: String!
    nickname: String!
    headline: String
    "マークダウンの自己紹介。未設定ならnull"
    bio: String
    avatar: MediaImage
    websites: [ProfileWebsite!]!
    "停止中の利用者を除いたフォロワー数"
    followerCount: Int!
    ultras: Boolean!
    "本人が停止中のときだけtrue。他の閲覧者には停止中の利用者のプロフィールを返さない"
    suspended: Boolean!
    viewerRelation: ProfileViewerRelation!
  }

  "旧ハンドルでの閲覧。handleは転送先の現在のハンドル"
  type PublicProfileRedirect {
    handle: String!
  }

  union PublicProfileResult = PublicProfile | PublicProfileRedirect

  type MyProfile {
    nickname: String!
    handle: String!
    "保持中の旧ハンドル。無ければnull"
    previousHandle: String
    headline: String
    bio: String
    avatar: MediaImage
    websites: [ProfileWebsite!]!
    suspended: Boolean!
  }

  input ProfileWebsiteInput {
    name: String
    url: String!
  }

  input UpdateMyProfileInput {
    nickname: String!
    handle: String!
    "画面を開いた時点のハンドル。保存の間に変更されていれば保存しない"
    expectedHandle: String!
    headline: String
    bio: String
    "保存後の画像。現在の画像のIDなら維持し、nullなら削除する"
    avatarFileId: ID
    websites: [ProfileWebsiteInput!]!
  }

  type Query {
    "見つからない・表示できないハンドルではnull(404)。旧ハンドルは転送先を返す"
    publicProfile(handle: String!): PublicProfileResult
    "ログイン中の利用者(停止中を含む)のプロフィール編集用の情報"
    myProfile: MyProfile!
    "ハンドルの使用可否。自分の現在と保持中の旧ハンドルは使えるものとして扱う"
    handleAvailability(handle: String!): HandleAvailability!
  }

  type Mutation {
    "メールアドレスが未確認の利用者も保存できる。停止中の利用者は保存できない"
    updateMyProfile(input: UpdateMyProfileInput!): MyProfile!
  }
`;
