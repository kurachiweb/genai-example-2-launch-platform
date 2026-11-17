export const YEAR_TOURNAMENT_TYPE_DEFS = /* GraphQL */ `
  "Yearトーナメントの状態。OPENは参加の受付中、DRAWINGは組み合わせの決定中、IN_PROGRESSは開催中、FINISHEDは終了"
  enum YearTournamentStatus {
    OPEN
    DRAWING
    IN_PROGRESS
    FINISHED
  }

  "Yearトーナメントの見出しの情報"
  type YearTournamentSummary {
    "対象年"
    year: Int!
    "対象年の表記(「2027年」)"
    label: String!
    "設定した決勝の実施日(業務日付のYYYY-MM-DD)"
    finalDate: String!
    "組み合わせの決定で記録した1回戦の実施日(業務日付のYYYY-MM-DD)。組み合わせの決定の前と参加0・1はnull"
    firstRoundDate: String
    status: YearTournamentStatus!
    "賞を授与すれば真、受賞なしで終了すれば偽、終了の前はnull。受賞したプロダクトが表示できなくなっても真のまま"
    awarded: Boolean
  }

  "トップページの区画の1行。年とラウンドごとに、その日のマッチを対戦カードと不戦勝に分ける"
  type YearTournamentRoundBoard {
    tournament: YearTournamentSummary!
    "ラウンドの番号(1回戦が1)"
    round: Int!
    "ラウンド名(「1回戦」「準決勝」など)"
    roundName: String!
    "決勝のラウンド"
    final: Boolean!
    "決勝の実施日(業務日付のYYYY-MM-DD)。遅れがあれば見込みの日"
    finalDate: String!
    "対戦カード。ブラケットの位置の順"
    matches: [Match!]!
    "不戦勝。ブラケットの位置の順。両者の不戦敗のマッチは含めない"
    byes: [MatchBye!]!
    "ブラケットのページの経路(/tournaments/year/<年>)"
    bracketPath: String!
  }

  "トップページのYearトーナメントの区画"
  type YearTournamentBoard {
    "業務日付(YYYY-MM-DD)"
    date: String!
    "照会の時点のサーバーの時刻。カウントダウンを合わせるのに使う"
    serverTime: DateTime!
    "年の昇順。その日にマッチが無ければ空"
    rounds: [YearTournamentRoundBoard!]!
  }

  "Yearトーナメントのブラケットのページ"
  type YearBracket {
    tournament: YearTournamentSummary!
    participantCount: Int!
    seedCount: Int!
    "ラウンドの昇順。参加0・1は空"
    rounds: [BracketRound!]!
    "受賞したプロダクト。受賞なし・終了の前・表示できなければnull"
    champion: MatchProduct
  }

  type Query {
    "トップページのYearトーナメントの区画。指定した業務日付(YYYY-MM-DD)のトーナメントのマッチを返す。ログインを求めない"
    yearTournamentBoard(date: String!): YearTournamentBoard!
    "Yearトーナメントのブラケット。年(4桁)が不正・行が無い・組み合わせを決定していなければnull。ログインを求めない"
    yearBracket(year: String!): YearBracket
  }
`;
