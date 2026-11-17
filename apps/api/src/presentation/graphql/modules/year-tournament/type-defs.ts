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

  "Yearトーナメントの参加の枠の状態。AWAITING_PAYMENTは参加費の支払い待ち、ENTITLEDは参加資格を得た、DRAWNは組み合わせに入った、EXPIREDは期限切れ、FORFEITEDは資格の喪失、EXCLUDEDは組み合わせ決定での除外"
  enum YearEntryStatus {
    AWAITING_PAYMENT
    ENTITLED
    DRAWN
    EXPIRED
    FORFEITED
    EXCLUDED
  }

  "参加の枠が終わった理由。DEADLINEは決済期限切れ、DELETEDはプロダクトの削除、WITHDRAWNは投稿者の退会、HIDDEN_OR_SUSPENDEDは組み合わせ決定の時点の非公開化・停止、OVER_CAPACITYは参加数の上限による除外、LATE_ENTRYは組み合わせ決定の後に確定したWeek優勝"
  enum YearEntryCloseReason {
    DEADLINE
    DELETED
    WITHDRAWN
    HIDDEN_OR_SUSPENDED
    OVER_CAPACITY
    LATE_ENTRY
  }

  "組み合わせに入った枠の進行"
  type YearEntryProgress {
    "敗退しておらず、優勝もしていない"
    alive: Boolean!
    "敗退したラウンド名。敗退していなければnull"
    eliminatedRoundName: String
    "Product of the Yearを受賞した"
    champion: Boolean!
  }

  "投稿者本人の参加費の導線"
  type YearEntryPanel {
    "決済の開始に渡すローンチのID"
    launchId: ID!
    "対象年"
    year: Int!
    "対象年の表記(「2027年」)"
    yearLabel: String!
    "Week優勝の週の表記(「2026年第47週(11/16〜11/22)」)"
    weekLabel: String!
    "対象年の決勝の実施日(業務日付のYYYY-MM-DD)"
    finalDate: String!
    status: YearEntryStatus!
    "終わった枠だけ"
    closeReason: YearEntryCloseReason
    "支払った参加費が自動の全額返金の対象(返金の依頼の前か依頼中)"
    refundable: Boolean!
    "Ultrasの特典により参加費を免除する"
    exempt: Boolean!
    "決済の開始の受付期限(23:00)"
    acceptUntil: DateTime!
    "決済期限"
    deadlineAt: DateTime!
    "組み合わせ決定の日時(23:45)"
    drawAt: DateTime!
    "参加費(税込のUSD)。決済を始められない枠と、決済サービスに到達できず照会できないときはnull"
    fee: Money
    "照会の時点のサーバーの時刻。秒読みを合わせるのに使う"
    serverTime: DateTime!
    "組み合わせに入った枠だけ"
    progress: YearEntryProgress
    "組み合わせに入りブラケットを作った枠だけ。ブラケットのページの経路(/tournaments/year/<年>)"
    bracketPath: String
  }

  type Query {
    "トップページのYearトーナメントの区画。指定した業務日付(YYYY-MM-DD)のトーナメントのマッチを返す。ログインを求めない"
    yearTournamentBoard(date: String!): YearTournamentBoard!
    "Yearトーナメントのブラケット。年(4桁)が不正・行が無い・組み合わせを決定していなければnull。ログインを求めない"
    yearBracket(year: String!): YearBracket
    "投稿者本人のプロダクトの直近のローンチの参加の枠。未ログインはunauthenticated、本人のプロダクトでない・枠が無ければnull"
    myYearEntry(productHandle: String!): YearEntryPanel
  }

  type Mutation {
    "Yearトーナメントの参加費の決済の開始。本人の受付中の枠に購入を作り、決済画面の経路に使う購入のIDを返す。受付期限の後はcheckout_closed"
    startYearTournamentCheckout(launchId: ID!): CheckoutStart!
  }
`;
