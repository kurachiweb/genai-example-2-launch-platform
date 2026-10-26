import { resetSync } from '@logtape/logtape';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { graphql } from 'graphql';
import { ContainerModule } from 'inversify';
import { afterAll, describe, expect, test } from 'vitest';

import { ensureLoggingConfigured } from '../../../../../lib/workers/logging/configure-logging.ts';
import { createInvocationContainer } from '../../../../../lib/workers/di/invocation-container.ts';
import {
  type DatabaseProbe,
  DefaultSystemStatusQuery,
  SYSTEM_TYPES,
  type SystemStatusQuery,
} from '../../../../application/system/system-status-query.ts';
import { D1DatabaseProbe } from '../../../../infrastructure/system/d1-database-probe.ts';
import { createFailingD1 } from '../../../../../test/support/failing-d1.ts';
import { createSessionAccess } from '../../../gateway/session-access.ts';
import {
  createGraphQLContext,
  type GraphQLContext,
} from '../../graphql-context.ts';
import { composeGatewaySchema } from '../../schema-composer.ts';
import { systemSchemaModule } from './index.ts';

interface SystemStatusData {
  readonly systemStatus: {
    readonly serverTime: string;
    readonly databaseReachable: boolean;
  };
}

const CORRELATION_ID = 'correlation-system-status';

const SYSTEM_STATUS_QUERY = /* GraphQL */ `
  query SystemStatus {
    systemStatus {
      serverTime
      databaseReachable
    }
  }
`;

const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const schema = composeGatewaySchema([systemSchemaModule]);

const silentConsole = Object.fromEntries(
  ['trace', 'debug', 'info', 'warn', 'error'].map((method) => [
    method,
    () => undefined,
  ]),
) as unknown as Console;

function createContext(db: D1Database = env.DB): GraphQLContext {
  const container = createInvocationContainer(
    {
      env: { ...env, DB: db },
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: CORRELATION_ID,
        clientIp: undefined,
      },
    },
    [
      {
        bindings: new ContainerModule(({ bind }) => {
          bind<DatabaseProbe>(SYSTEM_TYPES.DatabaseProbe).to(D1DatabaseProbe);
          bind<SystemStatusQuery>(SYSTEM_TYPES.SystemStatusQuery).to(
            DefaultSystemStatusQuery,
          );
        }),
      },
    ],
  );
  return createGraphQLContext({
    access: { caller: 'client' },
    container,
    correlationId: CORRELATION_ID,
    clientIp: undefined,
    session: createSessionAccess({
      container,
      caller: 'client',
      token: undefined,
    }),
    botToken: undefined,
  });
}

async function querySystemStatus(
  context: GraphQLContext,
): Promise<SystemStatusData['systemStatus']> {
  const result = await graphql({
    schema,
    source: SYSTEM_STATUS_QUERY,
    contextValue: context,
  });
  expect(result.errors).toBeUndefined();
  return (result.data as unknown as SystemStatusData).systemStatus;
}

afterAll(() => {
  resetSync();
});

describe('systemSchemaModule', () => {
  test('データベースに到達できれば、APIサーバーの現在時刻のRFC 3339形式の文字列と真を返す', async () => {
    const before = Date.now();

    const status = await querySystemStatus(createContext());

    const after = Date.now();
    expect(status.databaseReachable).toBe(true);
    expect(status.serverTime).toMatch(RFC3339_UTC_PATTERN);
    const serverTime = Date.parse(status.serverTime);
    expect(serverTime).toBeGreaterThanOrEqual(before);
    expect(serverTime).toBeLessThanOrEqual(after);
  });

  test('データベースへの問い合わせが失敗すれば、エラーにせず到達できないことを返す', async () => {
    ensureLoggingConfigured({
      appName: 'api',
      level: 'debug',
      console: silentConsole,
    });

    const status = await querySystemStatus(createContext(createFailingD1()));

    expect(status.databaseReachable).toBe(false);
    expect(status.serverTime).toMatch(RFC3339_UTC_PATTERN);
  });
});
