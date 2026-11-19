export const PUBLIC_API_TYPE_DEFS = /* GraphQL */ `
  type Query {
    "自分のAPIキーの発行の新しい順の一覧。停止中の利用者も読める"
    myApiKeys(first: Int = 50, after: String): ApiKeyConnection!
  }

  type Mutation {
    "新しいAPIキーを発行する。発行は再発行と合わせて利用者ごとに1時間3回まで"
    issueApiKey(input: ApiKeyInput!): IssuedApiKey!
    "自分のAPIキーの名前と権限スコープを変える。キーの文字列は変えない"
    updateApiKey(id: ID!, input: ApiKeyInput!): ApiKey!
    "自分のAPIキーと同じ名前と権限スコープの新しいキーを追加で発行する。元のキーは残す"
    reissueApiKey(id: ID!): IssuedApiKey!
    "自分のAPIキーを削除し、削除したキーのIDを返す。停止中の利用者も削除できる"
    deleteApiKey(id: ID!): ID!
  }

  "読み取りだけの機能の権限"
  enum ApiKeyReadLevel {
    NONE
    READ
  }

  "書き込みもできる機能の権限"
  enum ApiKeyWriteLevel {
    NONE
    READ
    READ_WRITE
  }

  "機能ごとの権限スコープ"
  type ApiKeyScopes {
    products: ApiKeyReadLevel!
    launches: ApiKeyReadLevel!
    upvotes: ApiKeyReadLevel!
    comments: ApiKeyReadLevel!
    ratings: ApiKeyReadLevel!
    profile: ApiKeyWriteLevel!
    productDescriptions: ApiKeyWriteLevel!
  }

  "APIキー。平文とハッシュは持たない"
  type ApiKey {
    id: ID!
    name: String!
    scopes: ApiKeyScopes!
    createdAt: DateTime!
  }

  type ApiKeyConnection {
    nodes: [ApiKey!]!
    pageInfo: PageInfo!
  }

  "発行・再発行の結果"
  type IssuedApiKey {
    apiKey: ApiKey!
    "平文のAPIキー。この応答でだけ返し、再び読めない"
    plainKey: String!
  }

  input ApiKeyScopesInput {
    products: ApiKeyReadLevel!
    launches: ApiKeyReadLevel!
    upvotes: ApiKeyReadLevel!
    comments: ApiKeyReadLevel!
    ratings: ApiKeyReadLevel!
    profile: ApiKeyWriteLevel!
    productDescriptions: ApiKeyWriteLevel!
  }

  input ApiKeyInput {
    "前後の空白を除いて1〜50文字"
    name: String!
    scopes: ApiKeyScopesInput!
  }
`;
