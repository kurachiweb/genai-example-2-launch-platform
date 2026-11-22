import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { ContainerModule } from 'inversify';
import { beforeEach } from 'vitest';

import { dataExports } from '../../db/schema/data-export/data-exports.ts';
import { users } from '../../db/schema/identity/users.ts';
import { DATA_EXPORT_REQUEST_WINDOW_SECONDS } from '../../common-lib/data-export/data-export-rules.ts';
import type { KeyedHasher } from '../../lib/core/crypto/keyed-hasher.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import type { WindowState } from '../../lib/core/rate-limit/fixed-window.ts';
import { hashRateLimitKey } from '../../lib/core/rate-limit/rate-limit-key.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  db as dataExportDb,
  exportIdOf,
  type ExportRow,
  queuedRowOf,
} from '../../lib/workers/data-export/testing/data-export-fixtures.ts';
import {
  clearIdentityTables,
  db as identityDb,
  insertUser,
  T0,
  userIdOf,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import type { MessagePublisher } from '../../lib/workers/messaging/queue-publisher.ts';
import { MODULES } from '../../src/composition/modules.ts';
import { DATA_EXPORT_REQUEST_RULE } from '../../src/infrastructure/data-export/counter-data-export-request-limits.ts';
import { dataExportSchemaModule } from '../../src/presentation/graphql/modules/data-export/index.ts';
import {
  createGraphQLGateway,
  type GatewayApp,
  type GatewayCallOptions,
} from './graphql-gateway.ts';

export { issueUserSession } from './payments-graphql-operations.ts';
export { codesOf, detailsOf } from './product-graphql-operations.ts';
export { exportIdOf, userIdOf };

export type DataExportStatusValue = 'PENDING' | 'READY' | 'EXPIRED' | 'FAILED';

export interface DataExportFields {
  readonly id: string;
  readonly status: DataExportStatusValue;
  readonly requestedAt: string;
  readonly completedAt: string | null;
  readonly expiresAt: string | null;
  readonly failedAt: string | null;
  readonly failureKind: 'ERROR' | 'TOO_LARGE' | null;
  readonly fileName: string | null;
  readonly byteSize: number | null;
  readonly downloadPath: string | null;
}

export interface DataExportConnectionFields {
  readonly nodes: readonly DataExportFields[];
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly endCursor: string | null;
  };
}

export interface PublishedMessage {
  readonly type: string;
  readonly body: unknown;
  readonly delaySeconds: number | undefined;
}

const DATA_EXPORT_SELECTION = /* GraphQL */ `
  id
  status
  requestedAt
  completedAt
  expiresAt
  failedAt
  failureKind
  fileName
  byteSize
  downloadPath
`;

export const MY_DATA_EXPORTS = /* GraphQL */ `
  query MyDataExports($first: Int, $after: String) {
    myDataExports(first: $first, after: $after) {
      nodes {
        ${DATA_EXPORT_SELECTION}
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const MY_DATA_EXPORTS_DEFAULT_PAGE = /* GraphQL */ `
  query MyDataExportsDefaultPage {
    myDataExports {
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

export const REQUEST_DATA_EXPORT = /* GraphQL */ `
  mutation RequestDataExport {
    requestDataExport {
      ${DATA_EXPORT_SELECTION}
    }
  }
`;

const published: PublishedMessage[] = [];

// 生成の依頼と見張りの送信を確かめるため、実際のキューへ送らずに記録する
const overridesModule: AppModule<GatewayApp> = {
  name: 'data-export-graphql-test-overrides',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<MessagePublisher>(PLATFORM_TYPES.MessagePublisher).toConstantValue({
      publish: (contract, body, options) => {
        published.push({
          type: contract.type,
          body,
          delaySeconds: options?.delaySeconds,
        });
        return Promise.resolve(crypto.randomUUID());
      },
    });
  }),
};

const dataExportGateway = createGraphQLGateway({
  documents: [
    MY_DATA_EXPORTS,
    MY_DATA_EXPORTS_DEFAULT_PAGE,
    REQUEST_DATA_EXPORT,
  ],
  schemaModules: [dataExportSchemaModule],
  overrides: [overridesModule],
});

export function readPublishedMessages(): readonly PublishedMessage[] {
  return [...published];
}

// 回数の記録(厳密カウンタ)はテストの間で消せないため、受け付けるテストは番号を使い回さない利用者を使う
let nextUserIndex = 100;

export async function freshExportUser(
  columns: Parameters<typeof insertUser>[1] = { emailVerifiedAt: T0 },
): Promise<number> {
  const index = nextUserIndex;
  nextUserIndex += 1;
  await insertUser(index, columns);
  return index;
}

export function installDataExportGraphQLTest(): void {
  beforeEach(async () => {
    published.splice(0);
    await dataExportDb.delete(dataExports);
    await clearIdentityTables();
  });
}

export function exportRowOf(
  index: number,
  userIndex: number,
  columns: Partial<ExportRow> = {},
): ExportRow {
  return queuedRowOf(index, userIndex, {
    userId: userIdOf(userIndex),
    ...columns,
  });
}

export async function readExportRowsOf(userIndex: number) {
  return identityDb
    .select()
    .from(dataExports)
    .where(eq(dataExports.userId, userIdOf(userIndex)));
}

export async function verifyEmail(userIndex: number): Promise<void> {
  await identityDb
    .update(users)
    .set({ emailVerifiedAt: T0 })
    .where(eq(users.id, userIdOf(userIndex)));
}

const WINDOW_STATE_KEY = 'window';

// 期間の始まりを1期間前へずらして期間の終わりのAlarmを実行し、24時間が経った後を再現する
export async function elapseRequestWindow(userIndex: number): Promise<void> {
  const container = createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
  const key = await hashRateLimitKey(
    container.get<KeyedHasher>(PLATFORM_TYPES.KeyedHasher),
    'data-export',
    userIdOf(userIndex),
  );
  const namespace = env.RATE_LIMIT_COUNTER;
  const stub = namespace.get(
    namespace.idFromName(`${DATA_EXPORT_REQUEST_RULE.name}:${key}`),
  );
  await runInDurableObject(stub, (_instance, state) => {
    const current = state.storage.kv.get<WindowState>(WINDOW_STATE_KEY);
    if (current === undefined) {
      throw new Error('回数の記録がありません。');
    }
    state.storage.kv.put(WINDOW_STATE_KEY, {
      ...current,
      windowStartedAt:
        current.windowStartedAt - DATA_EXPORT_REQUEST_WINDOW_SECONDS * 1000,
    });
  });
  await runDurableObjectAlarm(stub);
}

export function fetchMyDataExports(
  variables: { readonly first?: number; readonly after?: string | null },
  options?: GatewayCallOptions,
) {
  return dataExportGateway.call<{
    myDataExports: DataExportConnectionFields | null;
  }>(MY_DATA_EXPORTS, variables, options);
}

export function fetchMyDataExportsDefaultPage(options?: GatewayCallOptions) {
  return dataExportGateway.call<{
    myDataExports: {
      readonly nodes: readonly { readonly id: string }[];
      readonly pageInfo: DataExportConnectionFields['pageInfo'];
    } | null;
  }>(MY_DATA_EXPORTS_DEFAULT_PAGE, {}, options);
}

export function requestDataExport(options?: GatewayCallOptions) {
  return dataExportGateway.call<{
    requestDataExport: DataExportFields | null;
  }>(REQUEST_DATA_EXPORT, {}, options);
}
