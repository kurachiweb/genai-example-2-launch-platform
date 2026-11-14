import type { Hono } from 'hono';

import type { AppModule } from '../../../lib/core/di/app-module.ts';
import type { PlatformEnv } from '../../../lib/workers/env/platform-env.ts';
import type { PlatformHonoEnv } from '../../../lib/workers/http/hono-env.ts';
import {
  createPublicApiApp,
  OPENAPI_DOCUMENT_PATH,
  PUBLIC_API_BASE_PATH,
  type PublicApiApp,
  type PublicRestRoutes,
  registerApiKeySecurityScheme,
} from './public-api-app.ts';
import { createRouteTable, type PublicRouteTable } from './route-table.ts';

export interface OpenApiDocumentInfo {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
}

export interface RestModuleOptions {
  readonly info?: OpenApiDocumentInfo;
}

export interface RestModule<E extends PlatformEnv> {
  readonly module: AppModule<Hono<PlatformHonoEnv<E>>>;
  readonly routeTable: PublicRouteTable;
}

const OPENAPI_VERSION = '3.1.0';

const DEFAULT_DOCUMENT_INFO: OpenApiDocumentInfo = Object.freeze({
  title: 'Launch Stadium Public API',
  version: '1.0.0',
});

const PREFLIGHT_PATH = '/*';

const PREFLIGHT_STATUS = 204;

function registerDocumentRoute<E extends PlatformEnv>(
  api: PublicApiApp<E>,
  info: OpenApiDocumentInfo,
): void {
  // 経路は基準パスにマウントした子のアプリに登録されるため、相対のサーバーで仕様を読むツールに基準パスを示す
  api.doc31(OPENAPI_DOCUMENT_PATH, {
    openapi: OPENAPI_VERSION,
    // 仕様書の型は拡張項目(x-)の索引を求め、インターフェースの値はそのままでは代入できないため、新しいオブジェクトに写す
    info: { ...info },
    servers: [{ url: PUBLIC_API_BASE_PATH }],
  });
}

function registerPreflightRoute<E extends PlatformEnv>(
  api: PublicApiApp<E>,
): void {
  api.options(PREFLIGHT_PATH, (c) => c.body(null, PREFLIGHT_STATUS));
}

// 経路の表は作った時点の登録から算出するため、すべての経路を登録してから作る
export function createRestModule<E extends PlatformEnv>(
  routes: readonly PublicRestRoutes<E>[],
  options?: RestModuleOptions,
): RestModule<E> {
  const api = createPublicApiApp<E>();
  for (const register of routes) {
    register(api);
  }
  registerApiKeySecurityScheme(api);
  registerDocumentRoute(api, options?.info ?? DEFAULT_DOCUMENT_INFO);
  registerPreflightRoute(api);
  return {
    module: {
      name: 'public-rest',
      routes: (app) => {
        app.route(PUBLIC_API_BASE_PATH, api);
      },
    },
    routeTable: createRouteTable(api),
  };
}
