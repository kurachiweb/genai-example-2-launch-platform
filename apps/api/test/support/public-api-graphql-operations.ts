import { resetSync } from '@logtape/logtape';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';

import { users } from '../../db/schema/identity/users.ts';
import { apiKeys } from '../../db/schema/public-api/api-keys.ts';
import {
  db,
  insertUser,
  T0,
  userIdOf,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { clearApiKeyTables } from '../../lib/workers/public-api/testing/api-key-fixtures.ts';
import { publicApiSchemaModule } from '../../src/presentation/graphql/modules/public-api/index.ts';
import {
  createGraphQLGateway,
  type GatewayCallOptions,
} from './graphql-gateway.ts';
import {
  configureRecordingLogs,
  type LoggedObject,
} from './observability-recording.ts';

export { issueUserSession } from './payments-graphql-operations.ts';
export { codesOf, detailsOf } from './product-graphql-operations.ts';

export type ApiKeyReadLevelValue = 'NONE' | 'READ';

export type ApiKeyWriteLevelValue = 'NONE' | 'READ' | 'READ_WRITE';

export interface ApiKeyScopesFields {
  readonly products: ApiKeyReadLevelValue;
  readonly launches: ApiKeyReadLevelValue;
  readonly upvotes: ApiKeyReadLevelValue;
  readonly comments: ApiKeyReadLevelValue;
  readonly ratings: ApiKeyReadLevelValue;
  readonly profile: ApiKeyWriteLevelValue;
  readonly productDescriptions: ApiKeyWriteLevelValue;
}

export interface ApiKeyFields {
  readonly id: string;
  readonly name: string;
  readonly scopes: ApiKeyScopesFields;
  readonly createdAt: string;
}

export interface ApiKeyConnectionFields {
  readonly nodes: readonly ApiKeyFields[];
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly endCursor: string | null;
  };
}

export interface IssuedApiKeyFields {
  readonly apiKey: ApiKeyFields;
  readonly plainKey: string;
}

export interface ApiKeyInputVariables {
  readonly name: string;
  readonly scopes: ApiKeyScopesFields;
}

const API_KEY_SELECTION = /* GraphQL */ `
  id
  name
  scopes {
    products
    launches
    upvotes
    comments
    ratings
    profile
    productDescriptions
  }
  createdAt
`;

export const MY_API_KEYS = /* GraphQL */ `
  query MyApiKeys($first: Int, $after: String) {
    myApiKeys(first: $first, after: $after) {
      nodes {
        ${API_KEY_SELECTION}
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// 件数を省略した既定値を確かめるため、変数を持たない操作も載せる
export const MY_API_KEYS_DEFAULT_PAGE = /* GraphQL */ `
  query MyApiKeysDefaultPage {
    myApiKeys {
      nodes {
        id
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const ISSUE_API_KEY = /* GraphQL */ `
  mutation IssueApiKey($input: ApiKeyInput!) {
    issueApiKey(input: $input) {
      apiKey {
        ${API_KEY_SELECTION}
      }
      plainKey
    }
  }
`;

export const UPDATE_API_KEY = /* GraphQL */ `
  mutation UpdateApiKey($id: ID!, $input: ApiKeyInput!) {
    updateApiKey(id: $id, input: $input) {
      ${API_KEY_SELECTION}
    }
  }
`;

export const REISSUE_API_KEY = /* GraphQL */ `
  mutation ReissueApiKey($id: ID!) {
    reissueApiKey(id: $id) {
      apiKey {
        ${API_KEY_SELECTION}
      }
      plainKey
    }
  }
`;

export const DELETE_API_KEY = /* GraphQL */ `
  mutation DeleteApiKey($id: ID!) {
    deleteApiKey(id: $id)
  }
`;

const publicApiGateway = createGraphQLGateway({
  documents: [
    MY_API_KEYS,
    MY_API_KEYS_DEFAULT_PAGE,
    ISSUE_API_KEY,
    UPDATE_API_KEY,
    REISSUE_API_KEY,
    DELETE_API_KEY,
  ],
  schemaModules: [publicApiSchemaModule],
});

export interface PublicApiTestContext {
  readonly logs: () => readonly LoggedObject[];
}

// 各テストの前にAPIキーと利用者のテーブル、ログの記録を空にする。
// 発行の回数の記録(厳密カウンタ)はテストの間で消せないため、発行するテストはfreshApiKeyUserで他のテストと重ならない利用者を使う
export function installPublicApiGraphQLTest(): PublicApiTestContext {
  let logs: LoggedObject[] = [];

  beforeAll(() => {
    logs = configureRecordingLogs();
  });

  beforeEach(async () => {
    await clearApiKeyTables();
    logs.splice(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    resetSync();
  });

  return { logs: () => logs };
}

let nextUserIndex = 100;

// 発行の回数の記録が他のテストと重ならないよう、ファイルの中で番号を使い回さない
export async function freshApiKeyUser(
  columns: Parameters<typeof insertUser>[1] = { emailVerifiedAt: T0 },
): Promise<number> {
  const index = nextUserIndex;
  nextUserIndex += 1;
  await insertUser(index, columns);
  return index;
}

export async function readApiKeyRowsOf(userIndex: number) {
  return db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, userIdOf(userIndex)));
}

export function fetchMyApiKeys(
  variables: { readonly first?: number; readonly after?: string | null },
  options?: GatewayCallOptions,
) {
  return publicApiGateway.call<{
    myApiKeys: ApiKeyConnectionFields | null;
  }>(MY_API_KEYS, variables, options);
}

export function fetchMyApiKeysDefaultPage(options?: GatewayCallOptions) {
  return publicApiGateway.call<{
    myApiKeys: ApiKeyConnectionFields | null;
  }>(MY_API_KEYS_DEFAULT_PAGE, {}, options);
}

export function issueApiKey(
  input: ApiKeyInputVariables,
  options?: GatewayCallOptions,
) {
  return publicApiGateway.call<{
    issueApiKey: IssuedApiKeyFields | null;
  }>(ISSUE_API_KEY, { input }, options);
}

export function updateApiKey(
  variables: { readonly id: string; readonly input: ApiKeyInputVariables },
  options?: GatewayCallOptions,
) {
  return publicApiGateway.call<{
    updateApiKey: ApiKeyFields | null;
  }>(UPDATE_API_KEY, variables, options);
}

export function reissueApiKey(id: string, options?: GatewayCallOptions) {
  return publicApiGateway.call<{
    reissueApiKey: IssuedApiKeyFields | null;
  }>(REISSUE_API_KEY, { id }, options);
}

export function deleteApiKey(id: string, options?: GatewayCallOptions) {
  return publicApiGateway.call<{
    deleteApiKey: string | null;
  }>(DELETE_API_KEY, { id }, options);
}

// 停止中の拒否が発行の回数を消費していないことを、停止の解除の後の発行で確かめるため、利用者の状態を直接戻す
export async function reactivateUser(userIndex: number): Promise<void> {
  await db
    .update(users)
    .set({ status: 'active', suspendedAt: null })
    .where(eq(users.id, userIdOf(userIndex)));
}
