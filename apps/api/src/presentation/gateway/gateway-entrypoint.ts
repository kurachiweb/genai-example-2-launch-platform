import { WorkerEntrypoint } from 'cloudflare:workers';

import { applySecurityHeaders } from '../../../lib/workers/http/security-headers.ts';
import type { CallerKind } from './gateway-headers.ts';
import { markInternalRequest } from './internal-request.ts';

type IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

export function createGatewayEntrypointClass<E>(
  caller: CallerKind,
  handler: ExportedHandler<E>,
): new (ctx: ExecutionContext, env: E) => WorkerEntrypoint<E> {
  const { fetch: handleFetch } = handler;
  if (handleFetch === undefined) {
    throw new Error(
      'fetchを持たないハンドラーからは名前付きエントリポイントを作れません。',
    );
  }
  // Service Bindingsの呼び出し元は公開メソッドをRPCとして呼べるため、fetch以外のメソッドを定義しない
  return class GatewayEntrypoint extends WorkerEntrypoint<E> {
    override async fetch(request: Request): Promise<Response> {
      // WorkerEntrypointのfetchが受け取る要求の型は既定のcfのため、既定のエクスポートのfetchが受け取る型へそろえる(cfが無い場合はどちらもundefined)
      const marked = markInternalRequest(request, caller) as IncomingRequest;
      return applySecurityHeaders(
        await handleFetch(marked, this.env, this.ctx),
      );
    }
  };
}
