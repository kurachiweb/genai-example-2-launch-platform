import type { GraphQLError } from 'graphql';
import { createSchema, createYoga, type Plugin } from 'graphql-yoga';

const TYPE_DEFS = /* GraphQL */ `
  type Query {
    node: Node
    value: Int
  }

  type Node {
    child: Node
    value: Int
  }
`;

export interface LimitedOperationResult {
  readonly status: number;
  readonly body: {
    readonly data?: unknown;
    readonly errors?: readonly { readonly message: string }[];
  };
  readonly documentErrors: readonly GraphQLError[];
  readonly resolverCalls: number;
}

function captureErrors(sink: GraphQLError[]): Plugin {
  return {
    onResultProcess({ result }) {
      if ('errors' in result && result.errors !== undefined) {
        sink.push(...result.errors);
      }
    },
  };
}

export async function runLimitedOperation(
  query: string,
  plugins: readonly Plugin[],
): Promise<LimitedOperationResult> {
  let resolverCalls = 0;
  const resolve = (value: unknown) => () => {
    resolverCalls += 1;
    return value;
  };
  const documentErrors: GraphQLError[] = [];
  const yoga = createYoga({
    schema: createSchema({
      typeDefs: TYPE_DEFS,
      resolvers: {
        Query: { node: resolve({}), value: resolve(1) },
        Node: { child: resolve({}), value: resolve(1) },
      },
    }),
    plugins: [...plugins, captureErrors(documentErrors)],
    logging: false,
  });
  const response = await yoga.fetch('http://localhost/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return {
    status: response.status,
    body: await response.json(),
    documentErrors,
    resolverCalls,
  };
}

function nest(fields: readonly string[], innermost: string): string {
  return fields.reduceRight(
    (inner, field) => `${field} { ${inner} }`,
    innermost,
  );
}

// 深さは操作の直下の項目を1段目として数え、最も深い位置に子の選択を持たない項目を置く
export function depthQuery(depth: number): string {
  const childFields = Array.from({ length: depth - 2 }, () => 'child');
  return `{ ${nest(['node', ...childFields], 'value')} }`;
}

export function aliasQuery(aliasCount: number): string {
  const fields = Array.from(
    { length: aliasCount },
    (_, index) => `alias${String(index + 1)}: value`,
  );
  return `{ ${fields.join(' ')} }`;
}

// 深さ8の位置に子の選択を持たない項目を並べる。コストは64.34375 + 項目数 × 1.5^7(17.0859375)になる
export function costQuery(leafCount: number): string {
  const childFields = Array.from({ length: 6 }, () => 'child');
  const leaves = Array.from({ length: leafCount }, () => 'value').join(' ');
  return `{ ${nest(['node', ...childFields], leaves)} }`;
}

// 外側の波括弧2つと、項目名1つにつき1つの字句から成る
export function tokenQuery(tokenCount: number): string {
  return `{ ${Array.from({ length: tokenCount - 2 }, () => 'value').join(' ')} }`;
}

export function directiveQuery(directiveCount: number): string {
  const fields = Array.from(
    { length: directiveCount },
    () => 'value @include(if: true)',
  );
  return `{ ${fields.join(' ')} }`;
}
