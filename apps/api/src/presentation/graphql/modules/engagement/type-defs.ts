export const ENGAGEMENT_TYPE_DEFS = /* GraphQL */ `
  type Query {
    "ローンチへのコメントのページ。閲覧できないプロダクトと、別のプロダクト・取消・存在しないローンチはnull"
    launchComments(
      productId: ID!
      launchId: ID!
      after: String
    ): LaunchCommentConnection
    "取消を除くローンチごとの表示できるコメントの数。閲覧できないプロダクトはnull"
    launchCommentCounts(productId: ID!): [LaunchCommentCount!]
    "プロダクトの評価欄の値。閲覧できないプロダクトはnull"
    productRating(productId: ID!): ProductRating
  }

  "コメントの表示の状態。REMOVEDは削除・非公開化・匿名化・投稿者の退会や停止を区別しない置き換え表示"
  enum LaunchCommentState {
    SHOWN
    REMOVED
  }

  type LaunchComment {
    id: ID!
    "トップレベルはnull"
    parentId: ID
    depth: Int!
    state: LaunchCommentState!
    "REMOVEDと、投稿者を表示できなくなった競合はnull"
    author: UserSummary
    "マークダウンの本文。REMOVEDはnull"
    body: String
    "REMOVEDはnull"
    createdAt: DateTime
    "REMOVEDは偽"
    edited: Boolean!
    "投稿者がプロダクトの投稿者本人か。REMOVEDは偽"
    byProductOwner: Boolean!
    "投稿者が閲覧者自身か。REMOVEDは偽"
    viewerIsAuthor: Boolean!
  }

  "トップレベルのコメントと、その全ての返信を同じ親の中で古い順に平たく並べた一覧"
  type LaunchCommentThread {
    comment: LaunchComment!
    replies: [LaunchComment!]!
  }

  type LaunchCommentConnection {
    nodes: [LaunchCommentThread!]!
    pageInfo: PageInfo!
  }

  type LaunchCommentCount {
    launchId: ID!
    count: Int!
  }

  "プロダクトの評価欄の値"
  type ProductRating {
    productId: ID!
    "丸めない平均値。有効な評価が無ければnull"
    average: Float
    count: Int!
    "閲覧者の評価。未ログイン・投稿者本人・未評価はnull、管理者に無効化された評価も返す"
    viewerScore: Int
  }

  "トップレベルのコメントか返信の投稿。評価はトップレベルにだけ添えられ、添えなければ既存の評価を変えない"
  input PostCommentInput {
    productId: ID!
    launchId: ID!
    "トップレベルはnull"
    parentId: ID
    "マークダウンの本文"
    body: String!
    "1〜5の評価"
    rating: Int
  }

  "自分の表示できるコメントの編集。評価はトップレベルにだけ添えられ、添えなければ既存の評価を変えない"
  input UpdateCommentInput {
    commentId: ID!
    "マークダウンの本文"
    body: String!
    "1〜5の評価"
    rating: Int
  }

  type Mutation {
    "コメントとそれに添えた評価を1回の書き込みで保存する"
    postComment(input: PostCommentInput!): CommentMutationResult!
    "本文と、それに添えた評価を1回の書き込みで保存する"
    updateComment(input: UpdateCommentInput!): CommentMutationResult!
    "自分の表示できるコメントを置き換え表示にし、返信は残す"
    deleteComment(commentId: ID!): LaunchComment!
    "閲覧者のプロダクトへの評価を保存し、評価済みなら上書きする"
    rateProduct(productId: ID!, score: Int!): ProductRating!
    "閲覧者のプロダクトへの評価を物理削除する。評価が無くても成功する"
    cancelProductRating(productId: ID!): ProductRating!
  }

  "コメントの投稿と編集の結果"
  type CommentMutationResult {
    comment: LaunchComment!
    "評価を添えなければnull"
    rating: ProductRating
  }
`;
