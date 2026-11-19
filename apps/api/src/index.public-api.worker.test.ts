import { beforeAll, describe, expect, test } from 'vitest';

import { callPublic } from '../test/support/gateway-test-harness.ts';
import { API_ORIGIN } from '../test/support/graphql-request.ts';
import {
  ALL_SCOPES,
  createPublicApiRouteCaller,
  errorCodeOf,
  expectCors,
  NO_SCOPES,
  READ_ONLY_SCOPES,
  type RouteCase,
  routeLabelOf,
  ROUTES,
  SCOPE_COLUMNS,
  seedWorld,
  TOOL_ORIGIN,
  WRITE_ROUTES,
} from '../test/support/public-api-route-cases.ts';
import { describeRequiredScope } from './presentation/rest/public-api/route-definition.ts';

const { createKeyHolder, nextIp, routeRequest, preflightRequest } =
  createPublicApiRouteCaller({ firstHolderIndex: 1000, ipGroup: 1 });

beforeAll(seedWorld);

interface OpenApiParameter {
  readonly name: string;
  readonly in: string;
  readonly description?: string;
}

interface OpenApiOperation {
  readonly description?: string;
  readonly security?: unknown;
  readonly parameters?: readonly OpenApiParameter[];
  readonly responses: Readonly<Record<string, unknown>>;
}

interface OpenApiDocument {
  readonly paths: Readonly<
    Record<string, Readonly<Record<string, OpenApiOperation>>>
  >;
  readonly components: {
    readonly schemas: Readonly<
      Record<
        string,
        { readonly properties?: Readonly<Record<string, unknown>> }
      >
    >;
    readonly securitySchemes: Readonly<Record<string, unknown>>;
  };
}

async function fetchDocument(): Promise<OpenApiDocument> {
  const response = await callPublic(
    new Request(`${API_ORIGIN}/v1/openapi.json`, {
      headers: { 'CF-Connecting-IP': nextIp(), Origin: TOOL_ORIGIN },
    }),
  );
  expect(response.status).toBe(200);
  return response.json();
}

function operationOf(
  document: OpenApiDocument,
  route: RouteCase,
): OpenApiOperation {
  const operation =
    document.paths[route.template]?.[route.method.toLowerCase()];
  if (operation === undefined) {
    throw new Error(`仕様書に${routeLabelOf(route)}がありません`);
  }
  return operation;
}

describe('公開APIの仕様書(既定のエクスポート)', () => {
  test('認証なしで、design.mdの表の13経路を過不足なく載せる', async () => {
    const document = await fetchDocument();

    const operations = Object.entries(document.paths).flatMap(
      ([path, methods]) =>
        Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
    );

    expect(operations.toSorted()).toStrictEqual(
      ROUTES.map(routeLabelOf).toSorted(),
    );
    expect(ROUTES).toHaveLength(13);
  });

  test.each(ROUTES.map((route) => [routeLabelOf(route), route] as const))(
    '%sに、APIキーの認証・必要な権限・エラーの状態コードを載せる',
    async (_label, route) => {
      const document = await fetchDocument();

      const operation = operationOf(document, route);

      expect(operation.security).toStrictEqual([{ ApiKeyAuth: [] }]);
      expect(operation.description).toContain(
        describeRequiredScope(route.feature, route.access),
      );
      expect(
        Object.keys(operation.responses)
          .map(Number)
          .toSorted((first, second) => first - second),
      ).toStrictEqual(route.statuses);
    },
  );

  test('APIキーをBearerで送る認証の方式を載せる', async () => {
    const document = await fetchDocument();

    expect(document.components.securitySchemes).toStrictEqual({
      ApiKeyAuth: { type: 'http', scheme: 'bearer' },
    });
  });

  test.each(
    ROUTES.filter(({ cursor }) => cursor).map(
      (route) => [routeLabelOf(route), route] as const,
    ),
  )(
    'カーソルの経路の%sは、不正なカーソルが400(invalid_cursor)になることを載せる',
    async (_label, route) => {
      const document = await fetchDocument();

      const operation = operationOf(document, route);
      const cursor = operation.parameters?.find(
        (parameter) => parameter.name === 'cursor',
      );

      expect(cursor?.in).toBe('query');
      expect(cursor?.description).toContain('400(invalid_cursor)');
      expect(Object.keys(operation.responses)).toContain('400');
    },
  );

  test.each(['LaunchMatch', 'UpvoteHistoryEntry'])(
    '%sのマッチの種別と段階の値を列挙する',
    async (schemaName) => {
      const document = await fetchDocument();

      const properties = document.components.schemas[schemaName]?.properties;

      expect(properties?.kind).toMatchObject({
        enum: ['qualifier', 'week', 'year'],
      });
      expect(properties?.stage).toMatchObject({
        type: ['string', 'null'],
        enum: ['quarterfinal', 'semifinal', 'final', null],
      });
    },
  );
});

describe('公開APIの権限スコープ(既定のエクスポート)', () => {
  test('全ての権限が無効のキーは、13経路の全てを403(insufficient_scope)で拒否し、拒否の応答にもCORSのヘッダーを付ける', async () => {
    const { authorization } = await createKeyHolder(NO_SCOPES);

    for (const route of ROUTES) {
      const response = await callPublic(routeRequest(route, authorization));

      expect.soft(response.status, routeLabelOf(route)).toBe(403);
      expect
        .soft(await errorCodeOf(response), routeLabelOf(route))
        .toBe('insufficient_scope');
      expectCors(response, route);
    }
  });

  test('読み取りだけのキーは、更新の2経路を403(insufficient_scope)で拒否する', async () => {
    const { authorization } = await createKeyHolder(READ_ONLY_SCOPES);

    for (const route of WRITE_ROUTES) {
      const response = await callPublic(routeRequest(route, authorization));

      expect.soft(response.status, routeLabelOf(route)).toBe(403);
      expect
        .soft(await errorCodeOf(response), routeLabelOf(route))
        .toBe('insufficient_scope');
    }
    expect(WRITE_ROUTES.map(routeLabelOf)).toStrictEqual([
      'PATCH /me/profile',
      'PUT /me/products/{handle}/description',
    ]);
  });

  test.each(
    ROUTES.map((route) => [routeLabelOf(route), route.feature, route] as const),
  )(
    '%sは、「%s」の権限だけを無効にしたキーを403で拒否する',
    async (_label, feature, route) => {
      const { authorization } = await createKeyHolder({
        ...ALL_SCOPES,
        [SCOPE_COLUMNS[feature]]: 'none',
      });

      const response = await callPublic(routeRequest(route, authorization));

      expect(response.status).toBe(403);
      expect(await errorCodeOf(response)).toBe('insufficient_scope');
    },
  );
});

describe('公開APIのCORS(既定のエクスポート)', () => {
  test.each(ROUTES.map((route) => [routeLabelOf(route), route] as const))(
    '%sのプリフライトに、全てのオリジン・経路が受け付けるメソッド・許すヘッダーを204で返し、公開するヘッダーを示さない',
    async (_label, route) => {
      const response = await callPublic(preflightRequest(route));

      expect(response.status).toBe(204);
      expectCors(response, route);
      expect(response.headers.get('Access-Control-Max-Age')).toBe('600');
    },
  );
});

describe('公開APIのCORSの公開するヘッダー(既定のエクスポート)', () => {
  test('回数の制限のヘッダーを付けた成功の応答でも、Access-Control-Expose-Headersを付けない', async () => {
    const { authorization } = await createKeyHolder(ALL_SCOPES);
    const route = ROUTES[0];
    if (route === undefined) {
      throw new Error('経路がありません');
    }

    const response = await callPublic(routeRequest(route, authorization));

    expect(response.status).toBe(200);
    expect(response.headers.get('X-RateLimit-Limit')).not.toBeNull();
    expect(response.headers.get('Access-Control-Expose-Headers')).toBeNull();
    expectCors(response, route);
  });
});

describe('APIキーの無い要求(既定のエクスポート)', () => {
  test.each(ROUTES.map((route) => [routeLabelOf(route), route] as const))(
    '%sは、Authorizationの無い要求を401で拒否し、CORSのヘッダーを付ける',
    async (_label, route) => {
      const response = await callPublic(routeRequest(route));

      expect(response.status).toBe(401);
      expect(await errorCodeOf(response)).toBe('unauthenticated');
      expectCors(response, route);
    },
  );
});
