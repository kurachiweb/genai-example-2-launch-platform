export const HELP_TYPE_DEFS = /* GraphQL */ `
  enum HelpArticleStatus {
    DRAFT
    PUBLISHED
  }

  enum HelpArticleHandleAvailability {
    AVAILABLE
    "他の記事の旧ハンドルと一致する。保存するとその記事の旧URLの転送が無くなる"
    AVAILABLE_RELEASES_PREVIOUS
    UNAVAILABLE
    INVALID
  }

  type HelpArticleAuthor {
    nickname: String!
    title: String
    avatar: MediaImage
  }

  type HelpCategory {
    id: ID!
    name: String!
    systemDefault: Boolean!
    sortOrder: Int!
    "下書き・公開を問わない記事の件数"
    articleCount: Int!
  }

  type DeleteHelpCategoryPayload {
    id: ID!
    "標準カテゴリへ付け替えた記事の件数"
    reassignedCount: Int!
  }

  type AdminHelpArticleRow {
    id: ID!
    handle: String!
    title: String!
    categoryId: ID!
    categoryName: String!
    status: HelpArticleStatus!
    pinned: Boolean!
    sortOrder: Int!
    creatorAdminId: ID!
    "nullは削除済みの管理者"
    creator: HelpArticleAuthor
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type AdminHelpArticle {
    id: ID!
    handle: String!
    previousHandle: String
    title: String!
    subtitle: String!
    body: String!
    categoryId: ID!
    categoryName: String!
    status: HelpArticleStatus!
    pinned: Boolean!
    "nullは削除済みの管理者"
    creator: HelpArticleAuthor
    revision: Int!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  input HelpArticleFields {
    handle: String!
    title: String!
    subtitle: String!
    body: String!
    categoryId: ID!
    pinned: Boolean!
    status: HelpArticleStatus!
  }

  input CreateHelpArticleInput {
    fields: HelpArticleFields!
    reason: String
  }

  input UpdateHelpArticleInput {
    id: ID!
    expectedRevision: Int!
    fields: HelpArticleFields!
    reason: String
  }

  type DeleteHelpArticlePayload {
    id: ID!
  }

  type Query {
    "下書きを含む全件を更新日時の新しい順で返す"
    adminHelpArticles: [AdminHelpArticleRow!]!
    "見つからなければnull"
    adminHelpArticle(id: ID!): AdminHelpArticle
    "articleIdは編集中の記事のIDで、作成では省く"
    helpArticleHandleAvailability(
      handle: String!
      articleId: ID
    ): HelpArticleHandleAvailability!
    "管理者が指定した並び順"
    adminHelpCategories: [HelpCategory!]!
  }

  type Mutation {
    createHelpArticle(input: CreateHelpArticleInput!): AdminHelpArticle!
    updateHelpArticle(input: UpdateHelpArticleInput!): AdminHelpArticle!
    deleteHelpArticle(id: ID!, reason: String): DeleteHelpArticlePayload!
    "ピン留めの群に続けてそれ以外の群の順でカテゴリの全記事のIDを渡す"
    reorderHelpArticles(
      categoryId: ID!
      orderedIds: [ID!]!
    ): [AdminHelpArticleRow!]!
    createHelpCategory(name: String!): HelpCategory!
    renameHelpCategory(id: ID!, name: String!): HelpCategory!
    deleteHelpCategory(id: ID!): DeleteHelpCategoryPayload!
    "全カテゴリのIDを並べたい順で渡す"
    reorderHelpCategories(orderedIds: [ID!]!): [HelpCategory!]!
  }
`;
