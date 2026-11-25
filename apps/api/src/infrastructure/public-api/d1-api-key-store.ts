import { and, desc, eq, lt, or, sql, type SQL } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { ApiKeyScopes } from '../../../common-lib/public-api/api-key-rules.ts';
import type { Database } from '../../../db/client.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { visibleUsers } from '../../../db/schema/identity/visibility.ts';
import { apiKeys } from '../../../db/schema/public-api/api-keys.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  ApiKeyListPosition,
  ApiKeyRecord,
  ApiKeyStore,
  ApiKeyUpdate,
  NewApiKey,
} from '../../application/public-api/ports.ts';

// 停止中・退会済みの利用者の挿入だけが起こす違反。D1は`D1_ERROR: NOT NULL constraint failed: api_keys.user_id: SQLITE_CONSTRAINT (...)`を投げ、causeにSQLiteのエラーを持つ
const UNAVAILABLE_OWNER_PATTERN =
  /NOT NULL constraint failed: api_keys\.user_id(?::|$)/u;

const RECORD_COLUMNS = {
  id: apiKeys.id,
  userId: apiKeys.userId,
  name: apiKeys.name,
  scopeProducts: apiKeys.scopeProducts,
  scopeLaunches: apiKeys.scopeLaunches,
  scopeUpvotes: apiKeys.scopeUpvotes,
  scopeComments: apiKeys.scopeComments,
  scopeRatings: apiKeys.scopeRatings,
  scopeProfile: apiKeys.scopeProfile,
  scopeProductDescriptions: apiKeys.scopeProductDescriptions,
  createdAt: apiKeys.createdAt,
};

type RecordRow = Pick<typeof apiKeys.$inferSelect, keyof typeof RECORD_COLUMNS>;

function isUnavailableOwner(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (UNAVAILABLE_OWNER_PATTERN.test(current.message)) {
      return true;
    }
  }
  return false;
}

function toRecord(row: RecordRow): ApiKeyRecord {
  return {
    id: row.id,
    userId: row.userId,
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
  };
}

function scopeColumns(scopes: ApiKeyScopes) {
  return {
    scopeProducts: scopes.products,
    scopeLaunches: scopes.launches,
    scopeUpvotes: scopes.upvotes,
    scopeComments: scopes.comments,
    scopeRatings: scopes.ratings,
    scopeProfile: scopes.profile,
    scopeProductDescriptions: scopes.productDescriptions,
  } as const;
}

function positionCondition(
  before: ApiKeyListPosition | undefined,
): SQL | undefined {
  if (before === undefined) {
    return undefined;
  }
  return or(
    lt(apiKeys.createdAt, before.createdAt),
    and(eq(apiKeys.createdAt, before.createdAt), lt(apiKeys.id, before.id)),
  );
}

@injectable()
export class D1ApiKeyStore implements ApiKeyStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async findByHash(keyHash: string): Promise<ApiKeyRecord | undefined> {
    const [row] = await this.db
      .select(RECORD_COLUMNS)
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, keyHash))
      .limit(1);
    return row === undefined ? undefined : toRecord(row);
  }

  async findForOwner(
    userId: string,
    keyId: string,
  ): Promise<ApiKeyRecord | undefined> {
    const [row] = await this.db
      .select(RECORD_COLUMNS)
      .from(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
      .limit(1);
    return row === undefined ? undefined : toRecord(row);
  }

  async listByUser(
    userId: string,
    input: {
      readonly limit: number;
      readonly before: ApiKeyListPosition | undefined;
    },
  ): Promise<readonly ApiKeyRecord[]> {
    const rows = await this.db
      .select(RECORD_COLUMNS)
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), positionCondition(input.before)))
      .orderBy(desc(apiKeys.createdAt), desc(apiKeys.id))
      .limit(input.limit);
    return rows.map(toRecord);
  }

  // 確認と挿入の間に停止・退会が確定しても行を作らないよう、利用者の状態を挿入の文の条件にする。満たさなければ利用者IDがNULLになり、NOT NULL制約の違反で挿入が失敗する
  async insert(key: NewApiKey): Promise<'saved' | 'account-unavailable'> {
    const guardedUserId = sql<string>`CASE WHEN EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${key.userId} AND ${visibleUsers()}) THEN ${key.userId} ELSE NULL END`;
    try {
      await this.db.insert(apiKeys).values({
        id: key.id,
        userId: guardedUserId,
        name: key.name,
        keyHash: key.keyHash,
        ...scopeColumns(key.scopes),
        createdAt: key.at,
        updatedAt: key.at,
      });
      return 'saved';
    } catch (error) {
      if (isUnavailableOwner(error)) {
        return 'account-unavailable';
      }
      throw error;
    }
  }

  async update(input: ApiKeyUpdate): Promise<'updated' | 'not-found'> {
    const result = await this.db
      .update(apiKeys)
      .set({
        name: input.name,
        ...scopeColumns(input.scopes),
        updatedAt: input.at,
      })
      .where(
        and(eq(apiKeys.id, input.keyId), eq(apiKeys.userId, input.userId)),
      );
    return result.meta.changes > 0 ? 'updated' : 'not-found';
  }

  async delete(userId: string, keyId: string): Promise<boolean> {
    const result = await this.db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)));
    return result.meta.changes > 0;
  }
}
