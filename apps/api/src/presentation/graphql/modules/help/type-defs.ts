export const HELP_TYPE_DEFS = /* GraphQL */ `
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

  type Query {
    "管理者が指定した並び順"
    adminHelpCategories: [HelpCategory!]!
  }

  type Mutation {
    createHelpCategory(name: String!): HelpCategory!
    renameHelpCategory(id: ID!, name: String!): HelpCategory!
    deleteHelpCategory(id: ID!): DeleteHelpCategoryPayload!
    "全カテゴリのIDを並べたい順で渡す"
    reorderHelpCategories(orderedIds: [ID!]!): [HelpCategory!]!
  }
`;
