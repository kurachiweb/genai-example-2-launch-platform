import {
  UNEXPECTED_ERROR_MESSAGE,
  UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT,
} from '../messages/state-messages.ts';
import { z } from '../validation/zod.ts';

export interface FieldErrorDetail {
  readonly field: string;
  readonly message: string;
  readonly code: string;
}

export interface GraphQLClientErrorInit {
  readonly code: string;
  readonly message: string;
  readonly status: number;
  readonly details?: readonly FieldErrorDetail[] | undefined;
  readonly retryAfterSeconds?: number | undefined;
}

// apps/apiのsrc/presentation/graphql/error-codes.tsのGATEWAY_ERROR_CODESの写し。一致はルートのconfig/contract-copies.unit.test.tsが確かめる
const GATEWAY_ERROR_CODES: readonly string[] = [
  'persisted_operation_required',
  'persisted_operation_not_found',
  'query_depth_exceeded',
  'query_cost_exceeded',
  'query_aliases_exceeded',
  'query_tokens_exceeded',
  'query_directives_exceeded',
  'graphql_parse_failed',
  'graphql_validation_failed',
  'graphql_request_invalid',
  'internal_error',
];

const FRONTEND_UNEXPECTED_ERROR_CODES: readonly string[] = [
  'upstream_unavailable',
  'upstream_timeout',
  'network_error',
  'invalid_response',
];

// 想定内の失敗はapi-gatewayのAppErrorのコードと、エラートラッキングへ送らない中継の拒否(CSRF・IP制限・未登録の経路など)である。api-gatewayの実行前の拒否と内部エラー、APIへ届かなかったフロントエンドサーバーの中継の失敗、クライアント側で付ける通信の失敗と解釈できない応答は、エラートラッキングへ送るため想定外とする
const UNEXPECTED_ERROR_CODES: ReadonlySet<string> = new Set([
  ...GATEWAY_ERROR_CODES,
  ...FRONTEND_UNEXPECTED_ERROR_CODES,
]);

const INVALID_RESPONSE_MESSAGE =
  '現在ご利用いただけません。時間をおいて再度お試しください。';

const NETWORK_ERROR_MESSAGE =
  '通信に失敗しました。時間をおいて再度お試しください。';

export class GraphQLClientError extends Error {
  override readonly name = 'GraphQLClientError';
  readonly code: string;
  readonly status: number;
  readonly details: readonly FieldErrorDetail[] | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly expected: boolean;

  constructor(init: GraphQLClientErrorInit, options?: ErrorOptions) {
    super(init.message, options);
    this.code = init.code;
    this.status = init.status;
    this.details = init.details;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.expected = !UNEXPECTED_ERROR_CODES.has(init.code);
  }
}

export type GraphQLResult<TResult> =
  | { readonly ok: true; readonly data: TResult }
  | { readonly ok: false; readonly error: GraphQLClientError };

export interface GraphQLResponseInput {
  readonly status: number;
  readonly headers: Headers;
  readonly body: unknown;
}

const fieldErrorDetailsSchema = z.array(
  z.object({ field: z.string(), message: z.string(), code: z.string() }),
);

const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const graphqlErrorsSchema = z.object({
  errors: z
    .array(
      z.object({
        message: z.string(),
        extensions: z
          .object({ code: z.string(), details: z.unknown().optional() })
          .optional(),
      }),
    )
    .nonempty(),
});

const graphqlDataSchema = z.object({
  data: z.record(z.string(), z.unknown()),
});

const RETRY_AFTER_SECONDS_PATTERN = /^\d+$/u;

const parseRetryAfterSeconds = (headers: Headers): number | undefined => {
  const value = headers.get('retry-after');
  if (value === null || !RETRY_AFTER_SECONDS_PATTERN.test(value)) {
    return undefined;
  }
  return Number(value);
};

const parseFieldErrorDetails = (
  details: unknown,
): readonly FieldErrorDetail[] | undefined => {
  const parsed = fieldErrorDetailsSchema.safeParse(details);
  return parsed.success ? parsed.data : undefined;
};

const decodeBody = (body: unknown): unknown => {
  if (typeof body !== 'string') {
    return body;
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
};

const failure = <TResult>(
  init: GraphQLClientErrorInit,
): GraphQLResult<TResult> => ({
  ok: false,
  error: new GraphQLClientError(init),
});

const invalidResponse = <TResult>(status: number): GraphQLResult<TResult> =>
  failure({
    code: 'invalid_response',
    message: INVALID_RESPONSE_MESSAGE,
    status,
  });

export const parseGraphQLResponse = <TResult>(
  input: GraphQLResponseInput,
): GraphQLResult<TResult> => {
  const { status, headers } = input;
  const body = decodeBody(input.body);
  const retryAfterSeconds = parseRetryAfterSeconds(headers);

  const envelope = errorEnvelopeSchema.safeParse(body);
  if (envelope.success) {
    const { code, message, details } = envelope.data.error;
    return failure({
      code,
      message,
      status,
      details: parseFieldErrorDetails(details),
      retryAfterSeconds,
    });
  }

  const graphqlErrors = graphqlErrorsSchema.safeParse(body);
  if (graphqlErrors.success) {
    const [firstError] = graphqlErrors.data.errors;
    if (firstError?.extensions === undefined) {
      return invalidResponse(status);
    }
    return failure({
      code: firstError.extensions.code,
      message: firstError.message,
      status,
      details: parseFieldErrorDetails(firstError.extensions.details),
      retryAfterSeconds,
    });
  }

  const graphqlData = graphqlDataSchema.safeParse(body);
  if (graphqlData.success) {
    // 応答の形は生成した型を正とし、ここではdataが結果のオブジェクトであることだけを確かめる
    return { ok: true, data: graphqlData.data.data as TResult };
  }

  return invalidResponse(status);
};

export const requireData = <TResult>(
  result: GraphQLResult<TResult>,
): TResult => {
  if (!result.ok) {
    throw result.error;
  }
  return result.data;
};

export const createNetworkError = (cause: unknown): GraphQLClientError =>
  new GraphQLClientError(
    { code: 'network_error', message: NETWORK_ERROR_MESSAGE, status: 0 },
    { cause },
  );

// エラートラッキングの除外とブラウザの送信待ちの列で共用する。列は主バンドルに入るため、伏せ字のパターンを持つsentry-scrub.tsではなくここに置く
export const isExpectedFailure = (error: unknown): boolean =>
  error instanceof GraphQLClientError && error.expected;

// GraphQLClientErrorの文言は両側とも問い合わせを促さない契約のためそのまま返し、それ以外の例外は技術的な詳細を含み得るため固定の文言に代える
export const errorMessageOf = (
  error: unknown,
  contactAvailable: boolean,
): string => {
  if (error instanceof GraphQLClientError) {
    return error.message;
  }
  return contactAvailable
    ? UNEXPECTED_ERROR_MESSAGE
    : UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT;
};
