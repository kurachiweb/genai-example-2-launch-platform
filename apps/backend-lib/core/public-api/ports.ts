import type { ApiKeyScopes } from '../../../common-lib/public-api/api-key-rules.ts';

export interface ApiKeyExportRecord {
  readonly name: string;
  readonly scopes: ApiKeyScopes;
  readonly createdAt: Date;
}

export interface ApiKeyExport {
  // 発行の古い順。平文とハッシュは持たない
  listByUser(userId: string): Promise<readonly ApiKeyExportRecord[]>;
}
