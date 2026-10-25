import { z } from 'zod';

export type BotVerificationFailure =
  | 'missing-token'
  | 'invalid-token'
  | 'expired-or-duplicate'
  | 'action-mismatch'
  | 'hostname-mismatch'
  | 'unavailable'
  | 'misconfigured';

export type BotVerificationResult =
  | {
      readonly ok: true;
      readonly hostname: string;
      readonly action: string | undefined;
      readonly challengeTs: string;
    }
  | {
      readonly ok: false;
      readonly failure: BotVerificationFailure;
      readonly errorCodes: readonly string[];
    };

export interface VerificationExpectations {
  readonly action?: string;
  readonly hostnames: readonly string[];
}

export type SiteverifyOutcome =
  | {
      readonly kind: 'response';
      readonly status: number;
      readonly json: unknown;
    }
  | { readonly kind: 'network-error' }
  | { readonly kind: 'timeout' };

export const MAX_TOKEN_LENGTH = 2048;

type ErrorCodeFailure = Extract<
  BotVerificationFailure,
  'invalid-token' | 'expired-or-duplicate' | 'unavailable' | 'misconfigured'
>;

const FAILURE_BY_ERROR_CODE: ReadonlyMap<string, ErrorCodeFailure> = new Map([
  ['missing-input-response', 'invalid-token'],
  ['invalid-input-response', 'invalid-token'],
  ['timeout-or-duplicate', 'expired-or-duplicate'],
  ['missing-input-secret', 'misconfigured'],
  ['invalid-input-secret', 'misconfigured'],
  ['bad-request', 'misconfigured'],
  ['internal-error', 'unavailable'],
]);

// 設定の誤りは利用者の再試行では直らず運用者へ知らせる必要があり、障害時はトークンが正しく判定されていないため、この順で優先する
const FAILURE_PRIORITY: readonly ErrorCodeFailure[] = [
  'misconfigured',
  'unavailable',
  'expired-or-duplicate',
  'invalid-token',
];

const siteverifyResponseSchema = z.object({
  success: z.boolean(),
  hostname: z.string().optional(),
  challenge_ts: z.string().optional(),
  action: z.string().optional(),
  'error-codes': z.array(z.string()).optional(),
});

function failed(
  failure: BotVerificationFailure,
  errorCodes: readonly string[] = [],
): BotVerificationResult {
  return { ok: false, failure, errorCodes };
}

function isSuccessfulStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function classifyErrorCodes(errorCodes: readonly string[]): ErrorCodeFailure {
  const failures = new Set(
    errorCodes.map(
      (code) => FAILURE_BY_ERROR_CODE.get(code) ?? 'invalid-token',
    ),
  );
  return (
    FAILURE_PRIORITY.find((failure) => failures.has(failure)) ?? 'invalid-token'
  );
}

export function interpretSiteverify(
  outcome: SiteverifyOutcome,
  expectations: VerificationExpectations,
): BotVerificationResult {
  if (outcome.kind !== 'response' || !isSuccessfulStatus(outcome.status)) {
    return failed('unavailable');
  }
  const parsed = siteverifyResponseSchema.safeParse(outcome.json);
  if (!parsed.success) {
    return failed('unavailable');
  }
  const body = parsed.data;
  const errorCodes = body['error-codes'] ?? [];
  if (!body.success) {
    return failed(classifyErrorCodes(errorCodes), errorCodes);
  }
  if (body.hostname === undefined || body.challenge_ts === undefined) {
    return failed('unavailable');
  }
  if (
    expectations.action !== undefined &&
    body.action !== expectations.action
  ) {
    return failed('action-mismatch');
  }
  if (
    expectations.hostnames.length > 0 &&
    !expectations.hostnames.includes(body.hostname)
  ) {
    return failed('hostname-mismatch');
  }
  return {
    ok: true,
    hostname: body.hostname,
    action: body.action,
    challengeTs: body.challenge_ts,
  };
}
