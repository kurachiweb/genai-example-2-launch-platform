import { apiKeys } from '../../../../db/schema/public-api/api-keys.ts';
import {
  clearIdentityTables,
  db,
  T0,
  userIdOf,
} from '../../identity/testing/identity-store-fixtures.ts';

type ApiKeyRow = typeof apiKeys.$inferInsert;

export function apiKeyIdOf(index: number): string {
  return `01JC0APKEY${String(index).padStart(16, '0')}`;
}

export function keyHashOf(index: number): string {
  return `api-key-hash-${String(index)}`;
}

export async function insertApiKey(
  index: number,
  userIndex: number,
  columns: Partial<ApiKeyRow> = {},
): Promise<void> {
  await db.insert(apiKeys).values({
    id: apiKeyIdOf(index),
    userId: userIdOf(userIndex),
    name: `キー${String(index)}`,
    keyHash: keyHashOf(index),
    scopeProducts: 'read',
    scopeLaunches: 'read',
    scopeUpvotes: 'read',
    scopeComments: 'read',
    scopeRatings: 'read',
    scopeProfile: 'none',
    scopeProductDescriptions: 'none',
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  });
}

export async function clearApiKeyTables(): Promise<void> {
  await db.delete(apiKeys);
  await clearIdentityTables();
}
