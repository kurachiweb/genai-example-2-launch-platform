import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env, exports, type WorkerEntrypoint } from 'cloudflare:workers';

import { applySecurityHeaders } from '../../lib/workers/http/security-headers.ts';
import {
  apiHandler,
  publicEntrypoint,
} from '../../src/composition/api-worker.ts';
import type { CallerKind } from '../../src/presentation/gateway/gateway-headers.ts';
import { markInternalRequest } from '../../src/presentation/gateway/internal-request.ts';

export type TestEnv = typeof env;
export type EnvOverrides = Partial<TestEnv>;
export type GatewayEntrypointClass = new (
  ctx: ExecutionContext,
  env: TestEnv,
) => WorkerEntrypoint;

export interface RecordingRateLimiter {
  readonly binding: RateLimit;
  readonly keys: readonly string[];
}

type IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

export function envWith(overrides: EnvOverrides = {}): TestEnv {
  return { ...env, ...overrides };
}

async function withExecutionContext(
  run: (ctx: ExecutionContext) => Response | Promise<Response> | undefined,
): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await run(ctx);
  await waitOnExecutionContext(ctx);
  if (response === undefined) {
    throw new Error('fetchハンドラーがありません');
  }
  return response;
}

// 上書きが無ければWranglerの設定(ローカル環境)のまま名前付きエントリポイントを呼び、上書きがあれば同じ処理を上書きした環境で組み立てて呼ぶ
export async function callInternal(
  caller: CallerKind,
  request: Request,
  envOverrides?: EnvOverrides,
): Promise<Response> {
  if (envOverrides === undefined) {
    const entrypoint =
      caller === 'client' ? exports.ClientGateway : exports.AdminGateway;
    return entrypoint.fetch(request);
  }
  const response = await withExecutionContext((ctx) =>
    apiHandler.fetch?.(
      markInternalRequest(request, caller) as IncomingRequest,
      envWith(envOverrides),
      ctx,
    ),
  );
  return applySecurityHeaders(response);
}

export async function callPublic(
  request: Request,
  envOverrides?: EnvOverrides,
): Promise<Response> {
  if (envOverrides === undefined) {
    return exports.default.fetch(request);
  }
  return withExecutionContext((ctx) =>
    publicEntrypoint.fetch?.(
      request as IncomingRequest,
      envWith(envOverrides),
      ctx,
    ),
  );
}

export async function callEntrypoint(
  Entrypoint: GatewayEntrypointClass,
  request: Request,
  envOverrides?: EnvOverrides,
): Promise<Response> {
  return withExecutionContext((ctx) =>
    new Entrypoint(ctx, envWith(envOverrides)).fetch?.(request),
  );
}

export function recordingRateLimiter(
  allowed: boolean = true,
): RecordingRateLimiter {
  const keys: string[] = [];
  return {
    keys,
    binding: {
      limit: ({ key }) => {
        keys.push(key);
        return Promise.resolve({ success: allowed });
      },
    },
  };
}

export const failingRateLimiter: RateLimit = {
  limit: () => Promise.reject(new Error('IP制限の判定に失敗しました')),
};
