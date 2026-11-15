import { GraphQLError } from 'graphql';
import { createGraphQLError, type Plugin } from 'graphql-yoga';

import {
  AppError,
  STATUS_BY_KIND,
} from '../../../lib/core/errors/app-error.ts';
import { INTERNAL_ERROR_RESPONSE } from '../../../lib/core/errors/error-envelope.ts';
import {
  classifyDocumentError,
  GATEWAY_ERROR_CODES,
  type GatewayErrorCode,
  limitKindOf,
} from './error-codes.ts';

export interface ErrorPolicyOptions {
  readonly reportUnexpected: (error: unknown) => void;
}

export interface ErrorPolicy {
  readonly maskError: (error: unknown, message: string) => Error;
  readonly plugin: Plugin;
}

interface HttpExtension {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly spec?: boolean;
}

type ErrorLocation = Pick<
  GraphQLError,
  'nodes' | 'source' | 'positions' | 'path'
>;

const BAD_REQUEST_STATUS = 400;

const INTERNAL_ERROR_MESSAGE = INTERNAL_ERROR_RESPONSE.body.error.message;

const INTERNAL_ERROR_CODE = 'internal_error' satisfies GatewayErrorCode;

const REJECTION_CODE_SET: ReadonlySet<unknown> = new Set(
  GATEWAY_ERROR_CODES.filter((code) => code !== INTERNAL_ERROR_CODE),
);

function locationOf(error: unknown): Partial<ErrorLocation> {
  if (!(error instanceof GraphQLError)) {
    return {};
  }
  const { nodes, source, positions, path } = error;
  return { nodes, source, positions, path };
}

// リゾルバ・スカラーの例外はGraphQLErrorのoriginalErrorに入り、変数の強制変換では2段に包まれるため、包みを全て外す
function rootCause(error: unknown): unknown {
  let current = error;
  while (current instanceof GraphQLError && current.originalError) {
    current = current.originalError;
  }
  return current;
}

function rejectionCodeOf(error: GraphQLError): GatewayErrorCode | undefined {
  const { code } = error.extensions;
  return REJECTION_CODE_SET.has(code) ? (code as GatewayErrorCode) : undefined;
}

// 実行前に投げられた拒否は、許可リストと解析の拒否はコードを、検証中に投げられた上限の拒否は記録した種類を持つ。包まれたエラーは変数の強制変換などの要求の不正で、包まれた側のコードは使わない
function requestRejectionCodeOf(error: GraphQLError): GatewayErrorCode {
  if (error.originalError !== undefined) {
    return 'graphql_request_invalid';
  }
  return (
    rejectionCodeOf(error) ??
    (limitKindOf(error) === undefined
      ? 'graphql_request_invalid'
      : classifyDocumentError(error))
  );
}

// 実行前の拒否はpathを持たない要求単位のエラーだけで、internal_errorのコードはpolicyが作ったエラーにだけ認める
function isRequestRejection(
  error: unknown,
  cause: unknown,
): error is GraphQLError {
  return (
    error instanceof GraphQLError &&
    cause instanceof GraphQLError &&
    error.path === undefined &&
    error.extensions.code !== INTERNAL_ERROR_CODE
  );
}

function retryHttpOf(error: AppError): HttpExtension | undefined {
  if (error.kind !== 'rate_limited' && error.kind !== 'unavailable') {
    return undefined;
  }
  const status = STATUS_BY_KIND[error.kind];
  return error.retryAfterSeconds === undefined
    ? { status }
    : {
        status,
        headers: { 'Retry-After': String(error.retryAfterSeconds) },
      };
}

function fromAppError(error: unknown, cause: AppError): GraphQLError {
  const http = retryHttpOf(cause);
  return createGraphQLError(cause.message, {
    ...locationOf(error),
    extensions: {
      code: cause.code,
      ...(cause.details !== undefined && { details: cause.details }),
      ...(http !== undefined && { http }),
    },
  });
}

// GraphQL over HTTPはapplication/jsonの応答の検証の失敗を200とするため、specを偽にして状態コードを400に固定する
function badRequest(error: GraphQLError, code: GatewayErrorCode): GraphQLError {
  const http: HttpExtension = { status: BAD_REQUEST_STATUS, spec: false };
  return createGraphQLError(error.message, {
    ...locationOf(error),
    extensions: { code, http },
  });
}

// Yogaはunexpectedを持つエラーだけの応答でデータが無ければ500にし、応答の本文からは除く
function internalError(error: unknown): GraphQLError {
  return createGraphQLError(INTERNAL_ERROR_MESSAGE, {
    ...locationOf(error),
    extensions: { code: INTERNAL_ERROR_CODE, unexpected: true },
  });
}

function codeDocumentError(error: GraphQLError): GraphQLError {
  return badRequest(
    error,
    rejectionCodeOf(error) ?? classifyDocumentError(error),
  );
}

// 解析と検証の結果はYogaが文書ごとにキャッシュし、2回目以降は前段のプラグインの拒否を経ずに返すため、コードを付けたエラーをキャッシュさせる。解析の拒否は後段のYogaのプラグインがspecを真に書き換えるため、maskErrorで作り直す
const documentErrorPlugin: Plugin = {
  onParse() {
    return ({ result, replaceParseResult }) => {
      if (result instanceof GraphQLError) {
        replaceParseResult(codeDocumentError(result));
      }
    };
  },
  onValidate() {
    return ({ valid, result, setResult }) => {
      if (!valid) {
        setResult(
          result.map((error: unknown) =>
            error instanceof GraphQLError ? codeDocumentError(error) : error,
          ),
        );
      }
    };
  },
};

export function createErrorPolicy(options: ErrorPolicyOptions): ErrorPolicy {
  const masked = new WeakSet<GraphQLError>();
  const classify = (error: unknown): GraphQLError => {
    const cause = rootCause(error);
    if (cause instanceof AppError) {
      return fromAppError(error, cause);
    }
    if (isRequestRejection(error, cause)) {
      return badRequest(error, requestRejectionCodeOf(error));
    }
    options.reportUnexpected(cause);
    return internalError(error);
  };
  // 拡張のコードは投げた側が自由に付けられるため、伏せ済みかどうかはこのpolicyが作ったエラーと同一かで判定する
  const maskError = (error: unknown): Error => {
    if (error instanceof GraphQLError && masked.has(error)) {
      return error;
    }
    const result = classify(error);
    masked.add(result);
    return result;
  };
  return { maskError, plugin: documentErrorPlugin };
}
