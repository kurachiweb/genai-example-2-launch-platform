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

  type Query {
    "ログイン不要。予選に勝利した掲載中のプロダクトを1ページ20件で返す"
    directory(input: DirectoryInput!): DirectoryPage!
    "ログイン不要。掲載中のプロダクトの数が多い順・同数は名称順で、標準カテゴリを末尾に置き、掲載の無いカテゴリも返す"
    directoryCategories: [ProductCategory!]!
  }
`;
