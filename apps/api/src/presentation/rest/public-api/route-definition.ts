import { createRoute, type RouteConfig } from '@hono/zod-openapi';

import {
  API_KEY_FEATURE_LABELS,
  API_KEY_LEVEL_LABELS,
  type ApiKeyFeature,
} from '../../../../common-lib/public-api/api-key-rules.ts';
import type {
  ApiAccess,
  ApiTarget,
} from '../../../domain/public-api/api-key-scopes.ts';
import { API_KEY_SECURITY } from '../public-api-app.ts';
import { errorResponses } from '../responses.ts';
import { apiKeyAuth } from './api-key-auth.ts';

export interface PublicApiRouteDeclaration {
  readonly feature: ApiKeyFeature;
  readonly access: ApiAccess;
  // 停止中の持ち主のキーを、公開データ(public)の経路では処理し、自分のデータ(own)の経路では拒否する
  readonly target: ApiTarget;
}

type PublicApiRouteInput = Omit<RouteConfig, 'security' | 'middleware'> &
  PublicApiRouteDeclaration;

type AuthErrorStatus = 401 | 403 | 429;

const AUTH_ERROR_STATUSES: readonly AuthErrorStatus[] = Object.freeze([
  401, 403, 429,
]);

const ACCESS_LEVELS = Object.freeze({
  read: 'read',
  write: 'read_write',
} as const satisfies Record<ApiAccess, keyof typeof API_KEY_LEVEL_LABELS>);

export function describeRequiredScope(
  feature: ApiKeyFeature,
  access: ApiAccess,
): string {
  return `必要な権限: ${API_KEY_FEATURE_LABELS[feature]}の${API_KEY_LEVEL_LABELS[ACCESS_LEVELS[access]]}`;
}

function appendRequiredScope(
  description: string | undefined,
  declaration: PublicApiRouteDeclaration,
): string {
  const required = describeRequiredScope(
    declaration.feature,
    declaration.access,
  );
  return description === undefined ? required : `${description}\n\n${required}`;
}

// 宣言の項目は経路の定義の項目ではないため取り除き、仕様書の経路の項目に出さない
export function definePublicApiRoute<const R extends PublicApiRouteInput>(
  config: R,
) {
  const { feature, access, target, ...route } = config;
  return createRoute({
    ...route,
    description: appendRequiredScope(route.description, {
      feature,
      access,
      target,
    }),
    security: [...API_KEY_SECURITY],
    middleware: apiKeyAuth(feature, access, target),
    responses: {
      ...errorResponses(AUTH_ERROR_STATUSES),
      ...route.responses,
    },
  });
}
