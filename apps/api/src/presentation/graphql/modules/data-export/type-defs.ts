export const DATA_EXPORT_TYPE_DEFS = /* GraphQL */ `
  type Query {
    "自分のデータエクスポートの要求の新しい順の一覧。期限切れ・失敗を含む退会までの全ての要求を読め、停止中の利用者も読める"
    myDataExports(first: Int = 20, after: String): DataExportConnection!
  }

  type Mutation {
    "データエクスポートを要求する。ZIPの生成は非同期で、要求は利用者ごとに24時間に3回まで。作成中の要求があっても受け付ける"
    requestDataExport: DataExport!
  }

  "要求の表示の状態。作成中は受け付けと生成中をまとめる"
  enum DataExportStatus {
    PENDING
    READY
    EXPIRED
    FAILED
  }

  "失敗の種類。TOO_LARGEは生成物の上限を超えたことを表す"
  enum DataExportFailureKind {
    ERROR
    TOO_LARGE
  }

  "データエクスポートの要求。ZIPの実体は持たず、ダウンロードの経路を指す"
  type DataExport {
    id: ID!
    status: DataExportStatus!
    requestedAt: DateTime!
    "生成の完了日時。完了と期限切れだけが持つ"
    completedAt: DateTime
    "ZIPの有効期限。完了と期限切れだけが持つ"
    expiresAt: DateTime
    "失敗の日時。失敗だけが持つ"
    failedAt: DateTime
    failureKind: DataExportFailureKind
    "ZIPのファイル名。完了と期限切れだけが持つ"
    fileName: String
    "ZIPのバイト数。4GiB未満の整数で、GraphQLのIntが32ビットのためFloatで返す。完了と期限切れだけが持つ"
    byteSize: Float
    "ダウンロードの内部の経路。完了で有効期限の前のときだけ持つ"
    downloadPath: String
  }

  type DataExportConnection {
    nodes: [DataExport!]!
    pageInfo: PageInfo!
  }
`;
