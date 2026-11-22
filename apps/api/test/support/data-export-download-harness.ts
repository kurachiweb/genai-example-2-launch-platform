import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { ContainerModule } from 'inversify';

import { DATA_EXPORT_PLATFORM_TYPES } from '../../lib/core/data-export/identifiers.ts';
import type {
  DataExportIncident,
  DataExportIncidentReporter,
} from '../../lib/core/data-export/ports.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { createWorkerApp } from '../../lib/workers/http/create-worker-app.ts';
import {
  buildSentryOptions,
  readSentryRuntimeOptions,
} from '../../lib/workers/observability/sentry.ts';
import { apiEnvSchema } from '../../src/composition/env-schema.ts';
import { MODULES } from '../../src/composition/modules.ts';
import { RATE_LIMIT_EXCLUSIONS } from '../../src/composition/rate-limit-exclusions.ts';
import {
  type CallerKind,
  GATEWAY_HEADERS,
} from '../../src/presentation/gateway/gateway-headers.ts';
import { resolveGatewayClientIp } from '../../src/presentation/gateway/internal-request.ts';

type DownloadApp = ReturnType<typeof createWorkerApp<Env>>;

export interface DownloadOptions {
  readonly caller?: CallerKind | null;
  readonly token?: string | null;
}

const BASE_URL = 'https://api.launch.example';
const RELAYED_IP = '203.0.113.7';

const reported: DataExportIncident[] = [];

// エラートラッキングへ送る代わりに、送ろうとした事象を記録する
const overridesModule: AppModule<DownloadApp> = {
  name: 'data-export-download-test-overrides',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<DataExportIncidentReporter>(
      DATA_EXPORT_PLATFORM_TYPES.DataExportIncidentReporter,
    ).toConstantValue({
      report: (incident) => {
        reported.push(incident);
      },
    });
  }),
};

// 本物のモジュールの束縛と内部経路の登録のまま、事象の送信だけを差し替える
const app = createWorkerApp<Env>({
  appName: 'api',
  envSchema: apiEnvSchema,
  modules: [...MODULES, overridesModule],
  rateLimitExclusions: RATE_LIMIT_EXCLUSIONS,
  resolveClientIp: resolveGatewayClientIp,
  sentry: (bindings) =>
    buildSentryOptions({
      ...readSentryRuntimeOptions(bindings),
      dsn: undefined,
    }),
});

export function readReportedIncidents(): readonly DataExportIncident[] {
  return [...reported];
}

export function resetReportedIncidents(): void {
  reported.splice(0);
}

export async function downloadArchive(
  exportId: string,
  options: DownloadOptions = {},
  bindings: Partial<Env> = {},
): Promise<Response> {
  const caller = options.caller === undefined ? 'client' : options.caller;
  const headers = new Headers({ [GATEWAY_HEADERS.clientIp]: RELAYED_IP });
  if (caller !== null) {
    headers.set(GATEWAY_HEADERS.caller, caller);
  }
  if (options.token !== null && options.token !== undefined) {
    headers.set(GATEWAY_HEADERS.sessionToken, options.token);
  }
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request(`${BASE_URL}/internal/data-exports/${exportId}/archive`, {
      headers,
    }),
    { ...env, ...bindings },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}
