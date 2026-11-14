import type { PlatformEnv } from '../../../lib/workers/env/platform-env.ts';
import {
  OPENAPI_DOCUMENT_PATH,
  PUBLIC_API_BASE_PATH,
  type PublicApiApp,
} from './public-api-app.ts';

const HTTP_METHODS = Object.freeze([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
] as const);

export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface PublicRouteTable {
  methodsFor(pathname: string): readonly HttpMethod[];
}

interface RouteEntry {
  readonly method: HttpMethod;
  readonly pattern: RegExp;
}

const NO_METHODS: readonly HttpMethod[] = Object.freeze([]);

const PATH_VARIABLE = /\{[^/{}]+\}/u;

function toHttpMethod(method: string): HttpMethod | undefined {
  return HTTP_METHODS.find((candidate) => candidate === method.toUpperCase());
}

function escapeRegExp(literal: string): string {
  return literal.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

// 仕様書のパスの変数({name})を区切り(/)を含まない1文字以上の値として、それ以外を文字どおりに照合する
function compilePathPattern(path: string): RegExp {
  const source = path
    .split(PATH_VARIABLE)
    .map((literal) => escapeRegExp(literal))
    .join('[^/]+');
  return new RegExp(`^${source}$`, 'u');
}

function collectRouteEntries<E extends PlatformEnv>(
  api: PublicApiApp<E>,
): readonly RouteEntry[] {
  const registered = api.openAPIRegistry.definitions.flatMap((definition) => {
    if (definition.type !== 'route') {
      return [];
    }
    const method = toHttpMethod(definition.route.method);
    return method === undefined
      ? []
      : [{ method, pattern: compilePathPattern(definition.route.path) }];
  });
  return [
    ...registered,
    { method: 'GET', pattern: compilePathPattern(OPENAPI_DOCUMENT_PATH) },
  ];
}

function toRelativePath(pathname: string): string | undefined {
  if (!pathname.startsWith(`${PUBLIC_API_BASE_PATH}/`)) {
    return undefined;
  }
  return pathname.slice(PUBLIC_API_BASE_PATH.length);
}

export function createRouteTable<E extends PlatformEnv>(
  api: PublicApiApp<E>,
): PublicRouteTable {
  const entries = collectRouteEntries(api);
  return {
    methodsFor: (pathname) => {
      const relativePath = toRelativePath(pathname);
      if (relativePath === undefined) {
        return NO_METHODS;
      }
      const matched = new Set(
        entries
          .filter(({ pattern }) => pattern.test(relativePath))
          .map(({ method }) => method),
      );
      return Object.freeze(
        HTTP_METHODS.filter((method) => matched.has(method)),
      );
    },
  };
}
