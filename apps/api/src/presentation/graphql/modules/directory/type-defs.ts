export const DIRECTORY_TYPE_DEFS = /* GraphQL */ `
  "ディレクトリの並び順。RELEVANCEは検索語があるときだけ選べる"
  enum DirectorySort {
    RELEVANCE
    NEWEST
    OLDEST
    UPVOTES
  }

  "基準勝利の種類。VICTORYは勝敗の付いた勝利、BYEは対戦相手なし・マッチ直前の相手の該当による不戦勝、EARLYはマッチ中の相手の該当による即時の終了"
  enum DirectoryWinKind {
    VICTORY
    BYE
    EARLY
  }

  "一覧に表示する基準勝利の予選マッチ"
  type DirectoryWin {
    "基準勝利のローンチ日(YYYY-MM-DD)"
    launchDate: String!
    kind: DirectoryWinKind!
    "基準勝利での自身のUpvote数。BYEはnull"
    upvoteCount: Int
  }

  "他の機能が一覧の項目に加える値"
  type DirectoryItemMetric {
    key: String!
    value: Int!
  }

  "ディレクトリの一覧の項目"
  type DirectoryItem {
    handle: String!
    name: String!
    tagline: String!
    category: ProductCategory!
    "検証の済まないURLは空"
    websiteUrl: String!
    "画像の記録が無ければnull。隔離中の画像は枠だけを返し、objectKeyが空になる"
    logo: MediaImage
    "表示できなければnull"
    owner: UserSummary
    isViewerOwn: Boolean!
    "Yearを先頭"
    awards: [ProductAward!]!
    win: DirectoryWin!
    "登録の順。供給に失敗した値は含まない"
    metrics: [DirectoryItemMetric!]!
  }

  "サーバーが正規化した条件。既定の値の項目はnull"
  type DirectoryAppliedQuery {
    q: String
    "解決したカテゴリのハンドル"
    category: String
    from: String
    to: String
    sort: DirectorySort
    page: Int
  }

  "ディレクトリの一覧の1ページ"
  type DirectoryPage {
    applied: DirectoryAppliedQuery!
    "名称・タグラインの強調に使う検索語"
    searchTerms: [String!]!
    "照会の時点の業務日付(YYYY-MM-DD)"
    businessToday: String!
    totalCount: Int!
    page: Int!
    pageCount: Int!
    items: [DirectoryItem!]!
  }

  "URLのクエリと同じ条件。不正な値はエラーにせず既定の値として扱う"
  input DirectoryInput {
    q: String
    "カテゴリのハンドル(大文字小文字を区別しない)"
    category: String
    "業務日付(YYYY-MM-DD)"
    from: String
    "業務日付(YYYY-MM-DD)"
    to: String
    "relevance・newest・oldest・upvotes"
    sort: String
    "2以上の10進の整数"
    page: String
  }

  "マッチ履歴の対戦相手の見え方。NONEは対戦相手なし、PRIVATEは非公開化・投稿者の退会や停止・論理削除・紐付けの解除・不戦勝の相手、UNLISTEDは可視だが未掲載、LISTEDは掲載中"
  enum ProductPageOpponentKind {
    NONE
    PRIVATE
    UNLISTED
    LISTED
  }

  "マッチ履歴の対戦相手。NONE・PRIVATEはハンドル・名称・ロゴがnull"
  type ProductPageOpponent {
    kind: ProductPageOpponentKind!
    "LISTEDのときだけ値を持つ"
    handle: String
    name: String
    "画像の記録が無ければnull。隔離中の画像は枠だけを返し、objectKeyが空になる"
    logo: MediaImage
  }

  "マッチ履歴の結果が確定したマッチのこのプロダクトの側"
  type ProductPageMatch {
    id: ID!
    "このプロダクトの側。サポーターの一覧の照会に使う"
    entryId: ID!
    kind: MatchKind!
    "トーナメントのラウンドの番号(1回戦が1)。予選はnull"
    round: Int
    stage: MatchStage
    "実施日(業務日付のYYYY-MM-DD)"
    date: String!
    result: MatchEntryResult!
    decision: MatchDecision!
    "マッチ中の即時の終了で確定した"
    endedEarly: Boolean!
    "確定時点の自身のUpvote数"
    ownUpvoteCount: Int!
    "不戦勝(開始時点・マッチ中の相手の該当を含む)と対戦相手なしはnull"
    opponentUpvoteCount: Int
    opponent: ProductPageOpponent!
  }

  "マッチ履歴のローンチのブロック"
  type ProductPageLaunch {
    id: ID!
    "取消を除いて古い順に1から数える"
    number: Int!
    "業務日付(YYYY-MM-DD)"
    launchDate: String!
    kickoffAt: DateTime!
    status: LaunchStatus!
    summary: LaunchSummary!
    "マッチ中か結果が確定した"
    kickedOff: Boolean!
    "キックオフ済みで最も新しいローンチ"
    latestKickedOff: Boolean!
    "結果が確定したマッチを実施日の新しい順に"
    matches: [ProductPageMatch!]!
  }

  "ヘッダーの成績。勝ちは勝利・不戦勝、負けは敗北・両者敗北"
  type ProductPageRecord {
    "キックオフ済みで取り消されていないローンチの最も古いローンチ日(YYYY-MM-DD)。無ければnull"
    firstLaunchDate: String
    "キックオフ済みで取り消されていないローンチの数"
    launchCount: Int!
    wins: Int!
    losses: Int!
  }

  type ProductPageScreenshot {
    fileId: ID!
    "画像の記録が無ければnull。隔離中の画像は枠だけを返し、objectKeyが空になる"
    image: MediaImage
  }

  "プロダクト詳細ページ"
  type ProductPage {
    id: ID!
    "現在のハンドル。正規のURLに使う"
    handle: String!
    name: String!
    tagline: String!
    category: ProductCategory!
    "検証の済まないURLは空"
    websiteUrl: String!
    "画像の記録が無ければnull。隔離中の画像は枠だけを返し、objectKeyが空になる"
    logo: MediaImage
    "マークダウンの説明文"
    description: String!
    "表示順"
    screenshots: [ProductPageScreenshot!]!
    owner: UserSummary!
    viewerIsOwner: Boolean!
    "掲載中。偽なら投稿者本人だけが見ている"
    listed: Boolean!
    "Yearを先頭"
    awards: [ProductAward!]!
    record: ProductPageRecord!
    "取消を除く、ローンチ日の新しい順"
    launches: [ProductPageLaunch!]!
  }

  "プロダクト詳細ページの開催中のマッチ"
  type ProductLiveMatch {
    "照会の時点のサーバーの時刻。残り時間を合わせるのに使う"
    serverTime: DateTime!
    "マッチ中・集計中の最も新しいマッチ。無ければnull"
    match: Match
    "集計中のマッチがある、またはキックオフ済みのローンチの予選マッチが未作成・開始の時刻を過ぎて未開始"
    awaitingChange: Boolean!
  }

  "旧ハンドルでの照会。handleは転送先の現在のハンドル"
  type ProductPageRedirect {
    handle: String!
  }

  union ProductPageResult = ProductPage | ProductPageRedirect

  type SupporterConnection {
    "Upvoteの日時の早い順"
    nodes: [UserSummary!]!
    pageInfo: PageInfo!
  }

  type Query {
    "ログイン不要。予選に勝利した掲載中のプロダクトを1ページ20件で返す"
    directory(input: DirectoryInput!): DirectoryPage!
    "ログイン不要。掲載中のプロダクトの数が多い順・同数は名称順で、標準カテゴリを末尾に置き、掲載の無いカテゴリも返す"
    directoryCategories: [ProductCategory!]!
    "ログイン不要。ハンドルは大文字小文字を区別しない。存在しない・未掲載の他者・閲覧できないプロダクトはnull(404)、表示できる旧ハンドルは転送先を返す"
    productPage(handle: String!): ProductPageResult
    "ログイン不要。詳細ページの開催中のマッチ(定期の取り直しの対象)。表示できない・旧ハンドルはnull"
    productLiveMatch(productHandle: String!): ProductLiveMatch
    "ログイン不要。マッチの側にUpvoteした利用者を、退会・停止を除いてUpvoteの日時の早い順に返す。表示できないプロダクト・他のプロダクトの側・確定していないマッチはnull。firstは1〜20"
    matchSupporters(
      productHandle: String!
      matchId: ID!
      entryId: ID!
      first: Int!
      after: String
    ): SupporterConnection
  }
`;
