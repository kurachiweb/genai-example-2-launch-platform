import { resetSync } from '@logtape/logtape';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { ContainerModule } from 'inversify';
import { afterEach, describe, expect, test } from 'vitest';

import { createDatabase } from '../../../db/client.ts';
import { createInvocationContainer } from '../../../lib/workers/di/invocation-container.ts';
import { ensureLoggingConfigured } from '../../../lib/workers/logging/configure-logging.ts';
import {
  type DatabaseProbe,
  SYSTEM_TYPES,
} from '../../application/system/system-status-query.ts';
import {
  createFailingD1,
  FAILING_D1_MESSAGE,
} from '../../../test/support/failing-d1.ts';
import { D1DatabaseProbe } from './d1-database-probe.ts';

type ConsoleMethod = 'trace' | 'debug' | 'info' | 'warn' | 'error';

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

const PROBE_CATEGORY = 'api.infrastructure.system';

function configureRecordingLogs(): LoggedObject[] {
  const logs: LoggedObject[] = [];
  const record = (...args: unknown[]) => {
    logs.push(args[0] as LoggedObject);
  };
  const methods: Record<ConsoleMethod, typeof record> = {
    trace: record,
    debug: record,
    info: record,
    warn: record,
    error: record,
  };
  ensureLoggingConfigured({
    appName: 'api',
    level: 'debug',
    console: methods as unknown as Console,
  });
  return logs;
}

function probeLogs(logs: readonly LoggedObject[]): LoggedObject[] {
  return logs.filter((log) => log.category === PROBE_CATEGORY);
}

function resolveProbe(db: D1Database = env.DB): DatabaseProbe {
  const container = createInvocationContainer(
    {
      env: { ...env, DB: db },
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: 'correlation-database-probe',
        clientIp: undefined,
      },
    },
    [
      {
        bindings: new ContainerModule(({ bind }) => {
          bind<DatabaseProbe>(SYSTEM_TYPES.DatabaseProbe).to(D1DatabaseProbe);
        }),
      },
    ],
  );
  return container.get<DatabaseProbe>(SYSTEM_TYPES.DatabaseProbe);
}

afterEach(() => {
  resetSync();
});

describe('D1DatabaseProbe', () => {
  test('処理単位のデータベースに問い合わせられれば、真を返してログを出さない', async () => {
    const logs = configureRecordingLogs();
    const probe = resolveProbe();

    const reachable = await probe.isReachable();

    expect(reachable).toBe(true);
    expect(probeLogs(logs)).toEqual([]);
  });

  test('問い合わせが失敗すれば、例外を投げずに偽を返し、警告のログを1件出す', async () => {
    const logs = configureRecordingLogs();
    const probe = new D1DatabaseProbe(createDatabase(createFailingD1()));

    const reachable = await probe.isReachable();

    expect(reachable).toBe(false);
    const warnings = probeLogs(logs);
    expect(warnings).toMatchObject([
      { level: 'warning', message: 'データベースに到達できません' },
    ]);
    expect(JSON.stringify(warnings)).toContain(FAILING_D1_MESSAGE);
  });

  test('処理単位のD1のバインディングが失敗すれば、コンテナから解決した到達確認も偽を返す', async () => {
    configureRecordingLogs();
    const probe = resolveProbe(createFailingD1());

    await expect(probe.isReachable()).resolves.toBe(false);
  });
});
