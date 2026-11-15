export const SYSTEM_TYPE_DEFS = /* GraphQL */ `
  type Query {
    "APIサーバーの時刻とデータベースへの到達可否"
    systemStatus: SystemStatus!
  }

  type SystemStatus {
    serverTime: DateTime!
    databaseReachable: Boolean!
  }
`;
