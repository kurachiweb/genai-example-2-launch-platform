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

  "Weekトーナメントの参加の枠の状態。AWAITING_PAYMENTは参加費の支払い待ち、ENTITLEDは参加資格を得た、DRAWNは組み合わせに入った、EXPIREDは期限切れ、FORFEITEDは資格の喪失、EXCLUDEDは組み合わせ決定での除外"
  enum WeekEntryStatus {
    AWAITING_PAYMENT
    ENTITLED
    DRAWN
    EXPIRED
    FORFEITED
    EXCLUDED
  }

  "参加の枠が終わった理由。DEADLINEは決済期限切れ、DELETEDはプロダクトの削除、WITHDRAWNは投稿者の退会、HIDDEN_OR_SUSPENDEDは組み合わせ決定の時点の非公開化・停止、LATE_ENTRYは組み合わせ決定の後に確定した予選の勝利"
  enum WeekEntryCloseReason {
    DEADLINE
    DELETED
    WITHDRAWN
    HIDDEN_OR_SUSPENDED
    LATE_ENTRY
  }

  "組み合わせに入った枠の進行"
  type WeekEntryProgress {
    "敗退しておらず、優勝もしていない"
    alive: Boolean!
    "敗退したラウンド名。敗退していなければnull"
    eliminatedRoundName: String
    "Product of the Weekを受賞した"
    champion: Boolean!
  }

  "受付中で受付期限の前でも決済を始められない理由。文言は決済の開始の拒否と同じ"
  type WeekEntryCheckoutBlock {
    "決済の開始が拒否で返すエラーコード(week_entry_product_unavailable)"
    code: String!
    message: String!
  }

  "投稿者本人の参加費の導線"
  type WeekEntryPanel {
    "決済の開始に渡すローンチのID"
    launchId: ID!
    "ISO週(YYYY-Www)"
    week: String!
    "週の表記(「2026年第37週(9/7〜9/13)」)"
    weekLabel: String!
    status: WeekEntryStatus!
    "終わった枠だけ"
    closeReason: WeekEntryCloseReason
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
    "決済を始められる枠で、投稿者がUltrasの特典を受けていない。Ultrasの導線を表示するかは画面が機能フラグで決める"
    ultrasGuide: Boolean!
    "決済を始められる枠のうち、プロダクトを表示できない(非公開化・投稿者の停止)間だけ値がある。参加費とultrasGuideはそのまま返す"
    checkoutBlock: WeekEntryCheckoutBlock
    "照会の時点のサーバーの時刻。秒読みを合わせるのに使う"
    serverTime: DateTime!
    "組み合わせに入った枠だけ"
    progress: WeekEntryProgress
    "組み合わせに入りブラケットを作った枠だけ。ブラケットのページの経路(/tournaments/week/<ISO週>)"
    bracketPath: String
  }

  type Query {
    "トップページのWeekトーナメントの区画。指定した業務日付(YYYY-MM-DD)のトーナメントのマッチを返す。ログインを求めない"
    weekTournamentBoard(date: String!): WeekTournamentBoard!
    "Weekトーナメントのブラケット。週(YYYY-Www)が不正・組み合わせを決定していなければnull。ログインを求めない"
    weekBracket(week: String!): WeekBracket
    "投稿者本人のプロダクトの直近のローンチの参加の枠。未ログインはunauthenticated、本人のプロダクトでない・枠が無ければnull"
    myWeekEntry(productHandle: String!): WeekEntryPanel
    "プロダクト詳細ページのトロフィー。Yearを先頭に、同じ種類は受賞の新しい順に並べる。詳細ページを閲覧できなければnull。ログインを求めない"
    productTrophies(productHandle: String!): [Trophy!]
  }

  type Mutation {
    "Weekトーナメントの参加費の決済の開始。本人の受付中の枠に購入を作り、決済画面の経路に使う購入のIDを返す。受付期限の後はcheckout_closed"
    startWeekTournamentCheckout(launchId: ID!): CheckoutStart!
  }
`;
