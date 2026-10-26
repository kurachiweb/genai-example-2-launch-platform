import { usePersistedOperations } from '@graphql-yoga/plugin-persisted-operations';
import {
  createGraphQLError,
  type GraphQLParams,
  type Plugin,
} from 'graphql-yoga';
import { z } from 'zod';

import {
  CALLER_KINDS,
  type CallerKind,
  GATEWAY_HEADERS,
} from '../gateway/gateway-headers.ts';
import { readInternalCaller } from '../gateway/internal-request.ts';
import type { GatewayErrorCode } from './error-codes.ts';

export type DocumentId = `sha256:${string}`;

export interface AllowlistData {
  readonly version: 1;
  readonly operations: Readonly<
    Record<CallerKind, Readonly<Record<DocumentId, string>>>
  >;
}

export interface OperationAllowlist {
  find(caller: CallerKind, documentId: string): string | undefined;
}

export interface PersistedOperationsPluginOptions {
  readonly allowArbitrary: (request: Request) => boolean;
}

const DOCUMENT_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;

const DEFAULT_DEBUG_CALLER: CallerKind = 'client';

const callerOperationsSchema = z.record(
  z
    .string()
    .regex(DOCUMENT_ID_PATTERN)
    .transform((value) => value as DocumentId),
  z.string().min(1),
);

const allowlistSchema = z.strictObject({
  version: z.literal(1),
  operations: z.strictObject({
    client: callerOperationsSchema,
    admin: callerOperationsSchema,
  } satisfies Record<CallerKind, typeof callerOperationsSchema>),
}) satisfies z.ZodType<AllowlistData>;

type OperationsByCaller = ReadonlyMap<CallerKind, ReadonlyMap<string, string>>;

// 識別子は要求から来るため、Objectの組み込みの名前(constructorなど)を登録済みと誤らないようMapで照会する
function toOperationsByCaller(data: AllowlistData): OperationsByCaller {
  return new Map(
    CALLER_KINDS.map((caller) => [
      caller,
      new Map(Object.entries(data.operations[caller])),
    ]),
  );
}

export function createOperationAllowlist(data: unknown): OperationAllowlist {
  let operations: OperationsByCaller | undefined;
  const load = (): OperationsByCaller => {
    operations ??= toOperationsByCaller(allowlistSchema.parse(data));
    return operations;
  };
  return {
    find: (caller, documentId) => load().get(caller)?.get(documentId),
  };
}

function extractDocumentId(params: GraphQLParams): string | null {
  const { documentId } = params as GraphQLParams & {
    readonly documentId?: unknown;
  };
  return typeof documentId === 'string' ? documentId : null;
}

function readDebugCaller(request: Request): CallerKind {
  const value = request.headers.get(GATEWAY_HEADERS.debugCaller);
  return CALLER_KINDS.find((kind) => kind === value) ?? DEFAULT_DEBUG_CALLER;
}

// デバッグ用の呼び出し元は任意の操作を許す要求(ローカルのGraphiQL)でだけ読み、それ以外で内部経路でない要求はどの一覧も照会させない
function operationCaller(
  request: Request,
  allowArbitrary: (request: Request) => boolean,
): CallerKind | undefined {
  const internalCaller = readInternalCaller(request);
  if (internalCaller !== undefined) {
    return internalCaller;
  }
  return allowArbitrary(request) ? readDebugCaller(request) : undefined;
}

// 後続のプラグインがエラーを書き換えても他の要求に波及しないよう、要求ごとに新しいエラーを作る
function rejection(code: GatewayErrorCode, message: string): () => Error {
  return () =>
    createGraphQLError(message, {
      extensions: { code, http: { status: 400 } },
    });
}

const persistedOperationRequired = rejection(
  'persisted_operation_required',
  '登録済みの操作の識別子(documentId)を指定してください。',
);

const persistedOperationNotFound = rejection(
  'persisted_operation_not_found',
  '登録されていない操作です。',
);

export function createPersistedOperationsPlugin(
  allowlist: OperationAllowlist,
  options: PersistedOperationsPluginOptions,
): Plugin {
  return usePersistedOperations({
    allowArbitraryOperations: options.allowArbitrary,
    extractPersistedOperationId: extractDocumentId,
    getPersistedOperation: (documentId, request) => {
      const caller = operationCaller(request, options.allowArbitrary);
      return caller === undefined
        ? null
        : (allowlist.find(caller, documentId) ?? null);
    },
    customErrors: {
      persistedQueryOnly: persistedOperationRequired,
      keyNotFound: persistedOperationNotFound,
      notFound: persistedOperationNotFound,
    },
  });
}
