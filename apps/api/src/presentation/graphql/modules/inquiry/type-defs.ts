export const INQUIRY_TYPE_DEFS = /* GraphQL */ `
  type Query {
    "問い合わせフォームのカテゴリの選択肢。追加の順で、標準カテゴリを末尾に置く"
    inquiryCategories: [InquiryCategory!]!
    "問い合わせフォームに表示する送信者。停止していないログイン中の利用者だけ値を返す"
    inquiryComposer: InquiryComposer
    "自分のログインの問い合わせの一覧(20件ずつ、送信日時の新しい順)。停止中の利用者も読める"
    myInquiries(after: String): MemberInquiryPage!
    "本人の問い合わせのチャット。本人の問い合わせでなければnull"
    memberInquiry(id: ID!): MemberInquiry
    "管理画面のログインと未ログインの問い合わせの一覧(50件ずつ、受付日時の新しい順)。閲覧のみ以上"
    adminInquiries(
      filter: AdminInquiryFilterInput
      after: String
    ): AdminInquiryPage!
    "管理画面の問い合わせの詳細。退会済みも返し、見つからなければnull。閲覧のみ以上"
    adminInquiry(id: ID!): AdminInquiry
    "退会済みを除く「未対応」のログインと未ログインの問い合わせの合計件数。閲覧のみ以上"
    adminUnhandledInquiryCount: Int!
    "紐付く問い合わせの件数付きのカテゴリ。追加の順で、標準カテゴリを末尾に置く。閲覧のみ以上"
    adminInquiryCategories: [AdminInquiryCategory!]!
  }

  type Mutation {
    "未ログイン(停止中の利用者を含む)の問い合わせの送信"
    submitGuestInquiry(input: GuestInquiryInput!): Boolean!
    "停止していないログイン中の利用者の問い合わせの送信"
    submitMemberInquiry(input: MemberInquiryInput!): MemberInquiry!
    "本人の問い合わせへの追加メッセージ"
    postInquiryMessage(
      inquiryId: ID!
      input: InquiryMessageInput!
    ): InquiryMessage!
    "ログインの問い合わせへの管理者の返信。対応ステータスを変えない。モデレーター以上"
    replyToInquiry(
      inquiryId: ID!
      body: String!
      reason: String
    ): InquiryReplyResult!
    "対応ステータスの変更。変更後の詳細を返す。モデレーター以上"
    changeInquiryStatus(
      inquiryId: ID!
      status: InquiryStatus!
      reason: String
    ): AdminInquiry!
    "カテゴリの追加。モデレーター以上"
    createInquiryCategory(name: String!, reason: String): InquiryCategory!
    "カテゴリの名前の変更。標準カテゴリは変更できない。モデレーター以上"
    renameInquiryCategory(
      id: ID!
      name: String!
      reason: String
    ): InquiryCategory!
    "カテゴリの削除。紐付く問い合わせを標準カテゴリへ付け替える。モデレーター以上"
    deleteInquiryCategory(id: ID!, reason: String): Boolean!
  }

  "対応ステータス"
  enum InquiryStatus {
    OPEN
    IN_PROGRESS
    RESOLVED
    REJECTED
  }

  "問い合わせの種別"
  enum InquiryKind {
    MEMBER
    GUEST
  }

  "メッセージの送信者の種類"
  enum InquirySender {
    USER
    ADMIN
  }

  "問い合わせのカテゴリ"
  type InquiryCategory {
    id: ID!
    name: String!
    "削除できない標準カテゴリ「その他」なら真"
    systemDefault: Boolean!
  }

  "管理画面のカテゴリの区画が削除の確認に使う、紐付く問い合わせの件数(ログイン・未ログインの合計)付きのカテゴリ"
  type AdminInquiryCategory {
    id: ID!
    name: String!
    systemDefault: Boolean!
    linkedCount: Int!
  }

  "問い合わせフォームに表示する送信者"
  type InquiryComposer {
    nickname: String!
    "未登録・表示できない画像はnull"
    avatar: MediaImage
  }

  "返信した管理者"
  type InquiryReplyAuthor {
    "削除済みの管理者ではnull"
    nickname: String
    "未登録・表示できない画像と削除済みの管理者ではnull"
    avatar: MediaImage
    deleted: Boolean!
  }

  "問い合わせのメッセージ"
  type InquiryMessage {
    id: ID!
    sender: InquirySender!
    body: String!
    "位置の順。管理者の返信では空"
    attachments: [MediaAttachment!]!
    "利用者のメッセージではnull"
    admin: InquiryReplyAuthor
    createdAt: DateTime!
  }

  "利用者側のログインの問い合わせ"
  type MemberInquiry {
    id: ID!
    category: InquiryCategory!
    status: InquiryStatus!
    createdAt: DateTime!
    lastMessageAt: DateTime!
    "送信日時の古い順"
    messages: [InquiryMessage!]!
    "停止中の利用者では偽"
    canPost: Boolean!
  }

  "自分の問い合わせの一覧の1行"
  type MemberInquirySummary {
    id: ID!
    category: InquiryCategory!
    status: InquiryStatus!
    createdAt: DateTime!
    lastMessageAt: DateTime!
  }

  "自分の問い合わせの一覧の1ページ"
  type MemberInquiryPage {
    items: [MemberInquirySummary!]!
    "続きが無ければnull"
    nextCursor: String
  }

  "管理画面の問い合わせの一覧の1行"
  type AdminInquirySummary {
    id: ID!
    kind: InquiryKind!
    category: InquiryCategory!
    status: InquiryStatus!
    senderName: String!
    withdrawn: Boolean!
    createdAt: DateTime!
    lastMessageAt: DateTime!
  }

  "管理画面の問い合わせの一覧の1ページ(50件まで、受付日時の新しい順)"
  type AdminInquiryPage {
    entries: [AdminInquirySummary!]!
    "続きが無ければnull"
    nextCursor: String
  }

  "ログインの問い合わせを送った利用者"
  type AdminInquiryMember {
    userId: ID!
    nickname: String!
    handle: String!
    "未登録・表示できない画像はnull"
    avatar: MediaImage
  }

  "未ログインの問い合わせの送信者と本文"
  type AdminInquiryGuest {
    nickname: String!
    email: String!
    body: String!
  }

  "管理画面の問い合わせの詳細"
  type AdminInquiry {
    id: ID!
    kind: InquiryKind!
    category: InquiryCategory!
    status: InquiryStatus!
    statusChangedAt: DateTime!
    withdrawn: Boolean!
    createdAt: DateTime!
    lastMessageAt: DateTime!
    "未ログインの問い合わせと、送った利用者を読めないログインの問い合わせではnull"
    member: AdminInquiryMember
    "ログインの問い合わせではnull"
    guest: AdminInquiryGuest
    "送信日時の古い順"
    messages: [InquiryMessage!]!
  }

  "管理者の返信の結果"
  type InquiryReplyResult {
    message: InquiryMessage!
    "通知メールの送信要求に失敗したら偽"
    notificationQueued: Boolean!
  }

  "未ログインの問い合わせの送信"
  input GuestInquiryInput {
    categoryId: ID!
    nickname: String!
    email: String!
    body: String!
  }

  "ログインの問い合わせの送信"
  input MemberInquiryInput {
    categoryId: ID!
    body: String!
    "アップロード済みの問い合わせの添付のファイルのID"
    fileIds: [ID!]!
  }

  "追加メッセージの送信"
  input InquiryMessageInput {
    body: String!
    "アップロード済みの問い合わせの添付のファイルのID"
    fileIds: [ID!]!
  }

  "管理画面の問い合わせの一覧の絞り込み"
  input AdminInquiryFilterInput {
    status: InquiryStatus
    kind: InquiryKind
    categoryId: ID
    "この日時を含む以降の受付"
    receivedFrom: DateTime
    "この日時を含まない以前の受付"
    receivedBefore: DateTime
  }
`;
