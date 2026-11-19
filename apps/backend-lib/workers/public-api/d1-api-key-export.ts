import { asc, eq } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { apiKeys } from '../../../db/schema/public-api/api-keys.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  ApiKeyExport,
  ApiKeyExportRecord,
} from '../../core/public-api/ports.ts';

@injectable()
export class D1ApiKeyExport implements ApiKeyExport {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  // D1の失敗はデータエクスポートの再試行に任せるため例外のまま投げる
  async listByUser(userId: string): Promise<readonly ApiKeyExportRecord[]> {
    const rows = await this.db
      .select({
        name: apiKeys.name,
        scopeProducts: apiKeys.scopeProducts,
        scopeLaunches: apiKeys.scopeLaunches,
        scopeUpvotes: apiKeys.scopeUpvotes,
        scopeComments: apiKeys.scopeComments,
        scopeRatings: apiKeys.scopeRatings,
        scopeProfile: apiKeys.scopeProfile,
        scopeProductDescriptions: apiKeys.scopeProductDescriptions,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId))
      .orderBy(asc(apiKeys.createdAt), asc(apiKeys.id));
    return rows.map((row) => ({
      name: row.name,
      scopes: {
        products: row.scopeProducts,
        launches: row.scopeLaunches,
        upvotes: row.scopeUpvotes,
        comments: row.scopeComments,
        ratings: row.scopeRatings,
        profile: row.scopeProfile,
        productDescriptions: row.scopeProductDescriptions,
      },
      createdAt: row.createdAt,
    }));
  }
}
