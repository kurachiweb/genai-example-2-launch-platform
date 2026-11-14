export const LEGAL_TYPE_DEFS = /* GraphQL */ `
  type Query {
    "法務文書の最新版と改訂履歴"
    legalDocument(kind: LegalDocumentKind!): LegalDocument!
    "法務文書の指定した版。存在しない版はnull"
    legalDocumentVersion(
      kind: LegalDocumentKind!
      versionNumber: Int!
    ): LegalDocumentVersion
    "管理画面の法務文書の一覧。閲覧のみ以上の管理者"
    adminLegalDocuments: [AdminLegalDocumentSummary!]!
    "管理画面の編集の対象の法務文書。閲覧のみ以上の管理者"
    adminLegalDocument(kind: LegalDocumentKind!): AdminLegalDocument!
    "管理画面で表示する版。存在しない版はnull。閲覧のみ以上の管理者"
    adminLegalDocumentVersion(
      kind: LegalDocumentKind!
      versionNumber: Int!
    ): AdminLegalDocumentVersion
  }

  type Mutation {
    "下書きの保存。最上位管理者"
    saveLegalDocumentDraft(
      input: SaveLegalDocumentDraftInput!
    ): AdminLegalDocument!
    "下書きの破棄。最上位管理者"
    discardLegalDocumentDraft(
      input: DiscardLegalDocumentDraftInput!
    ): AdminLegalDocument!
    "下書きの公開。最上位管理者"
    publishLegalDocument(input: PublishLegalDocumentInput!): AdminLegalDocument!
  }

  "法務文書の種類"
  enum LegalDocumentKind {
    TERMS
    PRIVACY
    LEGAL_NOTICE
  }

  "改訂履歴の1版"
  type LegalRevision {
    versionNumber: Int!
    publishedAt: DateTime!
    changeSummary: String!
  }

  "公開した版"
  type LegalDocumentVersion {
    kind: LegalDocumentKind!
    versionNumber: Int!
    publishedAt: DateTime!
    changeSummary: String!
    body: String!
    isLatest: Boolean!
  }

  "利用者側に公開する法務文書"
  type LegalDocument {
    kind: LegalDocumentKind!
    "準備中ならnull"
    latest: LegalDocumentVersion
    "新しい順"
    revisions: [LegalRevision!]!
  }

  "版を公開した・下書きを保存した管理者"
  type LegalDocumentEditor {
    id: ID!
    "削除済みの管理者ではnull"
    nickname: String
  }

  "管理画面の改訂履歴の1版"
  type AdminLegalRevision {
    versionNumber: Int!
    publishedAt: DateTime!
    changeSummary: String!
    publishedBy: LegalDocumentEditor!
  }

  "保存済みの下書き"
  type AdminLegalDraft {
    body: String!
    savedAt: DateTime!
    savedBy: LegalDocumentEditor!
  }

  "管理画面の法務文書の一覧の1行"
  type AdminLegalDocumentSummary {
    kind: LegalDocumentKind!
    "未公開ならnull"
    latestVersionNumber: Int
    "未公開ならnull"
    latestPublishedAt: DateTime
    hasDraft: Boolean!
  }

  "管理画面の編集の対象の法務文書"
  type AdminLegalDocument {
    kind: LegalDocumentKind!
    "保存・破棄・公開で送り返す状態の版"
    stateVersion: Int!
    "未公開ならnull"
    latestBody: String
    "下書きが無ければnull"
    draft: AdminLegalDraft
    "新しい順"
    revisions: [AdminLegalRevision!]!
  }

  "管理画面で表示する版"
  type AdminLegalDocumentVersion {
    kind: LegalDocumentKind!
    versionNumber: Int!
    publishedAt: DateTime!
    changeSummary: String!
    body: String!
    isLatest: Boolean!
    publishedBy: LegalDocumentEditor!
  }

  "下書きの保存"
  input SaveLegalDocumentDraftInput {
    kind: LegalDocumentKind!
    expectedStateVersion: Int!
    body: String!
  }

  "下書きの破棄"
  input DiscardLegalDocumentDraftInput {
    kind: LegalDocumentKind!
    expectedStateVersion: Int!
  }

  "下書きの公開"
  input PublishLegalDocumentInput {
    kind: LegalDocumentKind!
    expectedStateVersion: Int!
    changeSummary: String!
  }
`;
