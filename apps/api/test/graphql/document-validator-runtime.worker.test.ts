import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { createDocumentValidator } from '../../scripts/graphql/document-validator.ts';
import {
  type AppEnvironment,
  GATEWAY_HEADERS,
} from '../../src/presentation/gateway/gateway-headers.ts';
import { createSessionAccess } from '../../src/presentation/gateway/session-access.ts';
import {
  createGatewayServer,
  type GatewayRequestScope,
  type GatewayServer,
} from '../../src/presentation/graphql/gateway-server.ts';
import { createOperationObservation } from '../../src/presentation/graphql/operation-observability.ts';
import { composeGatewaySchema } from '../../src/presentation/graphql/schema-composer.ts';
import { defineSchemaModule } from '../../src/presentation/graphql/schema-module.ts';
import { depthQuery } from '../support/query-limit-harness.ts';

interface RuntimeCase {
  readonly name: string;
  readonly document: string;
  readonly operationName?: string;
}

interface ResponseBody {
  readonly errors?: readonly {
    readonly extensions?: { readonly code?: string };
  }[];
}

const ENDPOINT = 'http://localhost/graphql';
const CORRELATION_ID = 'correlation-document-validator-runtime';

const SCHEMA_MODULES = [
  defineSchemaModule({
    name: 'document-validator-runtime',
    typeDefs: /* GraphQL */ `
      type Query {
        node: Node
        value: Int
      }

      type Node {
        child: Node
        value: Int
      }
    `,
    resolvers: {
      Query: { node: () => ({}), value: () => 1 },
      Node: { child: () => ({}), value: () => 1 },
    },
  }),
];

const CASES: readonly RuntimeCase[] = [
  {
    name: '__schemaを読むintrospection',
    document: 'query Schema { __schema { description } }',
  },
  {
    name: '__typeを読むintrospection',
    document: 'query TypeOf { __type(name: "Node") { name } }',
  },
  {
    name: 'Subscription型の無いスキーマへのsubscription',
    document: 'subscription Watch { value }',
  },
  {
    name: 'Mutation型の無いスキーマへのmutation',
    document: 'mutation Change { value }',
  },
  { name: '__typenameを読む操作', document: '{ __typename node { value } }' },
  {
    name: '複数の操作を持つ文書から選んだ操作',
    document: 'query First { value } query Second { node { value } }',
    operationName: 'Second',
  },
  { name: '存在しない項目', document: 'query Missing { missing }' },
  { name: '深さの超過', document: depthQuery(9) },
];

function documentIdOf(index: number): string {
  return `sha256:${index.toString(16).padStart(64, '0')}`;
}

const ALLOWLIST = {
  version: 1,
  operations: {
    client: Object.fromEntries(
      CASES.map(({ document }, index) => [documentIdOf(index), document]),
    ),
    admin: {},
  },
};

function createScope(): GatewayRequestScope {
  const container = createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: CORRELATION_ID,
        clientIp: undefined,
      },
    },
    [],
  );
  return {
    access: { kind: 'internal', caller: 'client' },
    container,
    correlationId: CORRELATION_ID,
    clientIp: undefined,
    session: createSessionAccess({
      container,
      caller: 'client',
      token: undefined,
    }),
    botToken: undefined,
    observation: createOperationObservation(),
  };
}

async function servedCodesOf(
  server: GatewayServer,
  index: number,
  operationName: string | undefined,
): Promise<(string | undefined)[]> {
  const response = await server.fetch(
    new Request(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [GATEWAY_HEADERS.caller]: 'client',
      },
      body: JSON.stringify({ documentId: documentIdOf(index), operationName }),
    }),
    { scope: createScope() },
  );
  const body = await response.json<ResponseBody>();
  return (body.errors ?? []).map((error) => error.extensions?.code);
}

const ENVIRONMENTS: readonly AppEnvironment[] = ['local', 'prod'];

describe.each(ENVIRONMENTS)(
  '生成時の検証と%s環境の内部経路の実行',
  (environment) => {
    const server = createGatewayServer({
      environment,
      schemaModules: SCHEMA_MODULES,
      allowlist: ALLOWLIST,
    });
    const validate = createDocumentValidator(
      composeGatewaySchema(SCHEMA_MODULES),
    );

    test.each(CASES.map((runtimeCase, index) => ({ ...runtimeCase, index })))(
      '$nameに同じエラーコードを返す',
      async ({ document, operationName, index }) => {
        const served = await servedCodesOf(server, index, operationName);

        expect(validate(document)).toStrictEqual(served);
      },
    );
  },
);
