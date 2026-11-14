export const CLIENT_SYSTEM_STATUS_OPERATION = Object.freeze({
  documentId:
    'sha256:f33460a833d45f333ad06d40ea70ccdb1b2eb0213b225245bb96e93ea1247a46',
  body: 'query SystemStatus { systemStatus { serverTime databaseReachable } }',
});

export const ADMIN_SYSTEM_STATUS_OPERATION = Object.freeze({
  documentId:
    'sha256:e247a56b566aa74464abdeada0fece6e965995caad0077f2a93f137622bd84f2',
  body: 'query AdminSystemStatus { systemStatus { databaseReachable } }',
});

// 登録箇所の疎通確認のモジュールに対し、利用者側と管理者側で異なる操作だけを登録した許可リスト
export const SYSTEM_ALLOWLIST = Object.freeze({
  version: 1,
  operations: {
    client: {
      [CLIENT_SYSTEM_STATUS_OPERATION.documentId]:
        CLIENT_SYSTEM_STATUS_OPERATION.body,
    },
    admin: {
      [ADMIN_SYSTEM_STATUS_OPERATION.documentId]:
        ADMIN_SYSTEM_STATUS_OPERATION.body,
    },
  },
});
