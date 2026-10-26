import {
  getActiveSpan,
  getRootSpan,
  SEMANTIC_ATTRIBUTE_SENTRY_OP,
  startSpan,
} from '@sentry/cloudflare';
import {
  type DocumentNode,
  getOperationAST,
  type GraphQLError,
  OperationTypeNode,
} from 'graphql';
import type { Plugin } from 'graphql-yoga';

import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { CallerKind } from '../gateway/gateway-headers.ts';

export type ObservedOperationType = 'query' | 'mutation';

export interface OperationObservation {
  operationName: string | undefined;
  operationType: ObservedOperationType | undefined;
  readonly errorCodes: string[];
}

export interface OperationObservabilityScope {
  readonly access: { readonly caller: CallerKind };
  readonly observation: OperationObservation;
}

export interface OperationObservabilityContext {
  readonly scope: OperationObservabilityScope;
}

export interface OperationLogInput {
  readonly caller: CallerKind;
  readonly observation: OperationObservation;
  readonly durationMs: number;
  readonly status: number;
}

type ObservabilityPlugin = Plugin<
  OperationObservabilityContext,
  OperationObservabilityContext
>;

type ProcessedResult = Parameters<
  NonNullable<ObservabilityPlugin['onResultProcess']>
>[0]['result'];

interface ResultWithErrors {
  readonly errors?: readonly GraphQLError[] | undefined;
}

type SpanAttributes = Record<string, string>;

const EXECUTE_SPAN_OP = 'graphql.execute';

const ERROR_STATUS_THRESHOLD = 400;

const OPERATION_LOG_MESSAGE = 'GraphQLの操作を処理しました';

const operationLogger = getAppLogger(['api', 'graphql', 'operation']);

export function createOperationObservation(): OperationObservation {
  return { operationName: undefined, operationType: undefined, errorCodes: [] };
}

function observedTypeOf(
  operation: OperationTypeNode | undefined,
): ObservedOperationType | undefined {
  switch (operation) {
    case OperationTypeNode.QUERY:
      return 'query';
    case OperationTypeNode.MUTATION:
      return 'mutation';
    default:
      return undefined;
  }
}

function recordOperation(
  observation: OperationObservation,
  document: DocumentNode,
  operationName: string | null | undefined,
): void {
  const operation = getOperationAST(document, operationName);
  observation.operationName = operation?.name?.value;
  observation.operationType = observedTypeOf(operation?.operation);
}

// 応答の結果はmaskErrorを通った後のエラーを持つため、伏せた後のコードだけが集まる
function errorCodesOf(result: ProcessedResult): string[] {
  if (Symbol.asyncIterator in result) {
    return [];
  }
  const results: readonly ResultWithErrors[] = Array.isArray(result)
    ? result
    : [result];
  return results.flatMap(({ errors }) =>
    (errors ?? []).flatMap(({ extensions }) =>
      typeof extensions.code === 'string' ? [extensions.code] : [],
    ),
  );
}

function recordErrorCodes(
  observation: OperationObservation,
  result: ProcessedResult,
): void {
  for (const code of errorCodesOf(result)) {
    if (!observation.errorCodes.includes(code)) {
      observation.errorCodes.push(code);
    }
  }
}

// 値は操作名・種類・呼び出し元だけとし、変数・本文・トークンを入れない
function spanAttributesOf(scope: OperationObservabilityScope): SpanAttributes {
  const { operationName, operationType } = scope.observation;
  return {
    ...(operationName !== undefined && {
      'graphql.operation.name': operationName,
    }),
    ...(operationType !== undefined && {
      'graphql.operation.type': operationType,
    }),
    'graphql.caller': scope.access.caller,
  };
}

// Sentryのhonoの計装は応答の時点でルートのスパンの名前を経路の名前へ書き戻すため、名前は変えずに属性で操作を表す
function annotateRootSpan(scope: OperationObservabilityScope): void {
  const activeSpan = getActiveSpan();
  if (activeSpan !== undefined) {
    getRootSpan(activeSpan).setAttributes(spanAttributesOf(scope));
  }
}

function executeSpanName(observation: OperationObservation): string {
  return ['graphql', observation.operationType, observation.operationName]
    .filter((part) => part !== undefined)
    .join(' ');
}

export function createOperationObservabilityPlugin(): ObservabilityPlugin {
  return {
    onValidate({ params: { documentAST }, context }) {
      recordOperation(
        context.scope.observation,
        documentAST as DocumentNode,
        context.params.operationName,
      );
    },
    onExecute({ context: { scope }, executeFn, setExecuteFn }) {
      setExecuteFn((executeArgs) =>
        startSpan(
          {
            name: executeSpanName(scope.observation),
            attributes: {
              [SEMANTIC_ATTRIBUTE_SENTRY_OP]: EXECUTE_SPAN_OP,
              ...spanAttributesOf(scope),
            },
          },
          (): unknown => executeFn(executeArgs),
        ),
      );
    },
    onResultProcess({ result, serverContext }) {
      recordErrorCodes(serverContext.scope.observation, result);
      annotateRootSpan(serverContext.scope);
    },
  };
}

export function logOperation(input: OperationLogInput): void {
  const { caller, observation, durationMs, status } = input;
  const failed =
    observation.errorCodes.length > 0 || status >= ERROR_STATUS_THRESHOLD;
  const properties = {
    operationName: observation.operationName ?? null,
    operationType: observation.operationType ?? null,
    caller,
    outcome: failed ? 'error' : 'ok',
    errorCodes: [...observation.errorCodes],
    status,
    durationMs,
  };
  if (failed) {
    operationLogger.warn(OPERATION_LOG_MESSAGE, properties);
  } else {
    operationLogger.info(OPERATION_LOG_MESSAGE, properties);
  }
}
