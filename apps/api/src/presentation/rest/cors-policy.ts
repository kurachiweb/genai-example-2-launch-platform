import type { CorsPolicy } from '../gateway/public-entrypoint.ts';
import { PUBLIC_API_BASE_PATH } from './public-api-app.ts';
import type { HttpMethod, PublicRouteTable } from './route-table.ts';

const PREFLIGHT_METHOD = 'OPTIONS';

const PREFLIGHT_MAX_AGE_SECONDS = 600;

const BODY_ACCEPTING_METHODS: ReadonlySet<HttpMethod> = new Set([
  'POST',
  'PUT',
  'PATCH',
]);

function isUnderBasePath(pathname: string): boolean {
  return (
    pathname === PUBLIC_API_BASE_PATH ||
    pathname.startsWith(`${PUBLIC_API_BASE_PATH}/`)
  );
}

function allowedHeaders(methods: readonly HttpMethod[]): string {
  const acceptsBody = methods.some((method) =>
    BODY_ACCEPTING_METHODS.has(method),
  );
  return acceptsBody ? 'Authorization, Content-Type' : 'Authorization';
}

// 公開APIはAPIキーをAuthorizationで受け取り、Cookieを使わないため、任意のオリジンを許可して資格情報は許可しない
export function createPublicApiCorsPolicy(table: PublicRouteTable): CorsPolicy {
  return {
    headersFor: (url) => {
      if (!isUnderBasePath(url.pathname)) {
        return undefined;
      }
      const methods = table.methodsFor(url.pathname);
      return Object.freeze({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': [...methods, PREFLIGHT_METHOD].join(
          ', ',
        ),
        'Access-Control-Allow-Headers': allowedHeaders(methods),
        'Access-Control-Max-Age': String(PREFLIGHT_MAX_AGE_SECONDS),
      });
    },
  };
}
