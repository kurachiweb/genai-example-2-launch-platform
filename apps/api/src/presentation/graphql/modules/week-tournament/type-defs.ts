export const WEEK_TOURNAMENT_TYPE_DEFS = /* GraphQL */ `
  "Weekトーナメントの状態。OPENは参加の受付中、DRAWINGは組み合わせの決定中、IN_PROGRESSは開催中、FINISHEDは終了"
  enum WeekTournamentStatus {
    OPEN
    DRAWING
    IN_PROGRESS
    FINISHED
  }

  "トロフィーの種類"
  enum TrophyKind {
    WEEK
    YEAR
  }

  "Weekトーナメントの見出しの情報"
  type WeekTournamentSummary {
    "ISO週(YYYY-Www)"
    week: String!
    "週の表記(「2026年第37週(9/7〜9/13)」)"
    label: String!
    "1回戦の実施日(業務日付のYYYY-MM-DD)。組み合わせの決定の前はnull"
    firstRoundDate: String
    "決勝の実施日(業務日付のYYYY-MM-DD)。遅れがあれば見込みの日。組み合わせの決定の前と参加0・1はnull"
    finalDate: String
    status: WeekTournamentStatus!
    "賞を授与すれば真、受賞なしで終了すれば偽、終了の前はnull"
    awarded: Boolean
  }

  "トップページの区画の1行。トーナメントとラウンドごとに、その日のマッチを対戦カードと不戦勝に分ける"
  type WeekTournamentRoundBoard {
    tournament: WeekTournamentSummary!
    "ラウンドの番号(1回戦が1)"
    round: Int!
    "ラウンド名(「1回戦」「準決勝」など)"
    roundName: String!
    "決勝のラウンド"
    final: Boolean!
    "対戦カード。ブラケットの位置の順"
    matches: [Match!]!
    "不戦勝。ブラケットの位置の順。両者の不戦敗のマッチは含めない"
    byes: [MatchBye!]!
    "ブラケットのページの経路(/tournaments/week/<ISO週>)"
    bracketPath: String!
  }

  "トップページのWeekトーナメントの区画"
  type WeekTournamentBoard {
    "業務日付(YYYY-MM-DD)"
    date: String!
    "照会の時点のサーバーの時刻。カウントダウンを合わせるのに使う"
    serverTime: DateTime!
    "1回戦の日の昇順。その日にマッチが無ければ空"
    rounds: [WeekTournamentRoundBoard!]!
  }

  "ブラケットのマッチの側の枠"
  type BracketSlot {
    "抽選番号。未確定の枠はnull"
    participantNo: Int
    "シードなら抽選番号"
    seed: Int
    "未来の枠の表記(「シード1」「1回戦第3試合の勝者」)"
    feedLabel: String
    "表示できない(非公開化・論理削除・投稿者の退会や停止)・未来の枠はnull"
    product: MatchProduct
    upvoteCount: Int
    "確定の前はnull"
    result: MatchEntryResult
  }

  "ブラケットの1つの位置"
  type BracketNode {
    "ラウンドの中の位置(1から)"
    position: Int!
    "マッチの予定を作っていない位置はnull"
    match: Match
    "2つの側の枠"
    slots: [BracketSlot!]!
  }

  "ブラケットのラウンド。WeekとYearのどちらのブラケットも同じ型で返す"
  type BracketRound {
    "ラウンドの番号(1回戦が1)"
    round: Int!
    "ラウンド名"
    name: String!
    "実施日(業務日付のYYYY-MM-DD)。予定の前は見込みの日"
    date: String!
    "位置の昇順。両方の側が空と確定した位置は含めない"
    nodes: [BracketNode!]!
  }

  "Weekトーナメントのブラケットのページ"
  type WeekBracket {
    tournament: WeekTournamentSummary!
    participantCount: Int!
    seedCount: Int!
    "ラウンドの昇順。参加0・1は空"
    rounds: [BracketRound!]!
    "受賞したプロダクト。受賞なし・終了の前・表示できなければnull"
    champion: MatchProduct
  }

  "プロダクトの受賞"
  type Trophy {
    kind: TrophyKind!
    "受賞の期間(「2026-W37」「2026」)"
    period: String!
    "期間の表記(「2026年第37週(9/7〜9/13)」「2026年」)"
    periodLabel: String!
    awardedAt: DateTime!
    "ブラケットのページの経路。無ければnull"
    bracketPath: String
  }

  type Query {
    "トップページのWeekトーナメントの区画。指定した業務日付(YYYY-MM-DD)のトーナメントのマッチを返す。ログインを求めない"
    weekTournamentBoard(date: String!): WeekTournamentBoard!
    "Weekトーナメントのブラケット。週(YYYY-Www)が不正・組み合わせを決定していなければnull。ログインを求めない"
    weekBracket(week: String!): WeekBracket
    "プロダクト詳細ページのトロフィー。Yearを先頭に、同じ種類は受賞の新しい順に並べる。詳細ページを閲覧できなければnull。ログインを求めない"
    productTrophies(productHandle: String!): [Trophy!]
  }
`;
