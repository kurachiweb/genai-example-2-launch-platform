export const MATCH_TYPE_DEFS = /* GraphQL */ `
  "マッチの種別"
  enum MatchKind {
    QUALIFIER
    WEEK
    YEAR
  }

  "トーナメントの段階。予選と段階の名前を持たないラウンドはnull"
  enum MatchStage {
    QUARTERFINAL
    SEMIFINAL
    FINAL
  }

  "マッチの状態。照会の時点の時刻から導く。SCHEDULEDは開始前、LIVEはマッチ中、TALLYINGは終了の日時を過ぎて確定の前、FINISHEDは結果の確定の後"
  enum MatchPhase {
    SCHEDULED
    LIVE
    TALLYING
    FINISHED
  }

  "側の結果。BYEは対戦相手なしの不戦勝、WALKOVERは相手の該当(退会・停止・非公開化など)による勝利"
  enum MatchEntryResult {
    WON
    LOST
    BYE
    WALKOVER
  }

  "マッチの決着。VOTESはUpvote数、LAST_UPVOTEは同数での最終Upvote時間、NO_VOTESは両者0票の両者敗北、BOTH_FORFEITEDは両方の側の該当による両者敗北"
  enum MatchDecision {
    VOTES
    LAST_UPVOTE
    NO_VOTES
    BYE
    WALKOVER
    BOTH_FORFEITED
  }

  "閲覧者がUpvoteできない理由"
  enum UpvoteRestriction {
    GUEST
    EMAIL_NOT_VERIFIED
    ACCOUNT_UNAVAILABLE
    OWN_MATCH
    NOT_ACCEPTING
  }

  "不戦勝の理由。ABSENTは対戦相手なし、FORFEITはマッチ直前の相手の該当、EARLYはマッチ中の即時の終了"
  enum ByeReason {
    ABSENT
    FORFEIT
    EARLY
  }

  "トップページの予選の表示。LIVEは終了の時刻(23:40)の前、RESULTはその後の結果の表示"
  enum QualifierBoardPhase {
    LIVE
    RESULT
  }

  "マッチの側のプロダクト"
  type MatchProduct {
    handle: String!
    name: String!
    tagline: String!
    category: ProductCategory!
    websiteUrl: String!
    "画像の記録が無ければnull。隔離中の画像は枠だけを返し、objectKeyが空になる"
    logo: MediaImage
    "掲載済み(可視かつ予選で勝利したローンチがある)"
    listed: Boolean!
  }

  type MatchEntry {
    id: ID!
    "表示できなければnull(非公開化・投稿者の退会や停止・論理削除・紐付けの解除)"
    product: MatchProduct
    "閲覧者自身のプロダクトの側"
    isViewerOwn: Boolean!
    upvoteCount: Int!
    "確定の前はnull"
    result: MatchEntryResult
    "配色の番号。紐付けを解除した側は0、それ以外はプロダクトのIDで決まる1〜12"
    colorIndex: Int!
  }

  type Match {
    id: ID!
    kind: MatchKind!
    "トーナメントのラウンドの番号(1回戦が1)。予選はnull"
    round: Int
    stage: MatchStage
    "実施日(業務日付のYYYY-MM-DD)"
    date: String!
    startsAt: DateTime!
    endsAt: DateTime!
    phase: MatchPhase!
    "確定の前はnull"
    decision: MatchDecision
    "マッチ中の即時の終了で確定した"
    endedEarly: Boolean!
    "側の番号の順"
    entries: [MatchEntry!]!
    "閲覧者が有効なUpvoteをしている側。未ログイン・Upvoteなしはnull"
    viewerUpvotedEntryId: ID
    "閲覧者がUpvoteできなければその理由。できればnull"
    viewerRestriction: UpvoteRestriction
  }

  "対戦カードにしない不戦勝のマッチ"
  type MatchBye {
    match: Match!
    "勝ち上がる側"
    entry: MatchEntry!
    reason: ByeReason!
  }

  "トップページの当日の予選"
  type QualifierBoard {
    "業務日付(YYYY-MM-DD)"
    date: String!
    "照会の時点のサーバーの時刻。カウントダウンを合わせるのに使う"
    serverTime: DateTime!
    phase: QualifierBoardPhase!
    "当日の予選の終了の時刻"
    fullTimeAt: DateTime!
    "翌日のキックオフの時刻"
    nextKickoffAt: DateTime!
    "当日のペアリングが未完了、または開始の日時を過ぎて開始も確定もしていない当日の予選がある"
    awaitingKickoff: Boolean!
    "対戦カードと即時の終了の不戦勝の数"
    heldCount: Int!
    "対戦カード。合計のUpvote数が最も多いマッチを先頭に、残りを合計の少ない順に並べる"
    matches: [Match!]!
    "不戦勝。マッチのIDの順"
    byes: [MatchBye!]!
  }

  "Upvoteする側"
  input UpvoteInput {
    matchId: ID!
    entryId: ID!
  }

  type Query {
    "トップページの当日の予選。開始済みの予選を対戦カードと不戦勝に分けて返す。ログインを求めない"
    qualifierBoard: QualifierBoard!
  }

  type Mutation {
    "メールアドレスが確認済みの利用者がマッチ中のマッチの一方の側にUpvoteする。もう一方の側にUpvote済みなら付け替え、同じ側なら何も変えない。更新後のマッチを返す"
    upvote(input: UpvoteInput!): Match!
    "メールアドレスが確認済みの利用者がマッチ中のマッチのUpvoteを取り消す。Upvoteしていなくても成功する。更新後のマッチを返す"
    cancelUpvote(matchId: ID!): Match!
  }
`;
