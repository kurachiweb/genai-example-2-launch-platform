import { applySecurityHeaders } from '../../../lib/workers/http/security-headers.ts';
import { stripGatewayHeaders } from './internal-request.ts';

export interface CorsPolicy {
  headersFor(url: URL): Readonly<Record<string, string>> | undefined;
}

export interface PublicEntrypointOptions {
  readonly cors: CorsPolicy;
}

function applyPublicResponseHeaders(
  response: Response,
  corsHeaders: Readonly<Record<string, string>> | undefined,
): Response {
  // applySecurityHeadersは書き換えられないヘッダーの応答を複製して返すため、その結果へは続けて書き込める
  const secured = applySecurityHeaders(response);
  for (const [name, value] of Object.entries(corsHeaders ?? {})) {
    secured.headers.set(name, value);
  }
  return secured;
}

export function createPublicEntrypoint<E>(
  handler: ExportedHandler<E>,
  options: PublicEntrypointOptions,
): ExportedHandler<E> {
  const { fetch: handleFetch } = handler;
  if (handleFetch === undefined) {
    return handler;
  }
  return {
    ...handler,
    fetch: async (request, env, ctx) => {
      // ヘッダーを除いた複製はcfを引き継ぐが、型は既定のcfに戻るため受け取った要求の型へ戻す
      const stripped = stripGatewayHeaders(request) as typeof request;
      const response = await handleFetch(stripped, env, ctx);
      return applyPublicResponseHeaders(
        response,
        options.cors.headersFor(new URL(request.url)),
      );
    },
  };
}
