import { captureMessage } from '@sentry/cloudflare';

import {
  type BotVerificationFailure,
  type BotVerificationResult,
  interpretSiteverify,
  MAX_TOKEN_LENGTH,
  type SiteverifyOutcome,
  type VerificationExpectations,
} from '../../core/bot-protection/siteverify-result.ts';
import { AppError } from '../../core/errors/app-error.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';

export interface BotVerificationInput {
  readonly token: string | undefined;
  readonly remoteIp: string | undefined;
  readonly expectedAction?: string;
}

export interface BotVerifier {
  verify(input: BotVerificationInput): Promise<BotVerificationResult>;
  assertHuman(input: BotVerificationInput): Promise<void>;
}

export type HttpFetch = (
  input: Request | string,
  init?: RequestInit,
) => Promise<Response>;

export interface TurnstileVerifierOptions {
  readonly secretKey: string;
  readonly expectedHostnames: readonly string[];
  readonly fetch: HttpFetch;
  readonly timeoutMs?: number;
}

export const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export const BOT_VERIFICATION_FAILED_MESSAGE =
  '認証に失敗しました。ページを再読み込みして再度お試しください。';
export const BOT_VERIFICATION_UNAVAILABLE_MESSAGE =
  '現在ご利用いただけません。時間をおいて再度お試しください。';

const DEFAULT_TIMEOUT_MS = 5000;
const UNAVAILABLE_RETRY_AFTER_SECONDS = 5;
const MISCONFIGURED_REPORT_MESSAGE = 'bot判定の検証の設定に誤りがあります';

// 判定サービスの障害と設定の誤りは利用者の入力では直らないため、再試行を促す503にする
const UNAVAILABLE_FAILURES: ReadonlySet<BotVerificationFailure> = new Set([
  'unavailable',
  'misconfigured',
]);

const logger = getAppLogger(['api', 'infrastructure', 'bot-protection']);

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError';
}

async function readJson(response: Response): Promise<SiteverifyOutcome> {
  try {
    return {
      kind: 'response',
      status: response.status,
      json: await response.json(),
    };
  } catch (error) {
    if (isTimeout(error)) {
      return { kind: 'timeout' };
    }
    return { kind: 'response', status: response.status, json: undefined };
  }
}

async function requestSiteverify(
  options: TurnstileVerifierOptions,
  token: string,
  remoteIp: string | undefined,
): Promise<SiteverifyOutcome> {
  let response: Response;
  try {
    response = await options.fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: options.secretKey,
        response: token,
        remoteip: remoteIp,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    return isTimeout(error) ? { kind: 'timeout' } : { kind: 'network-error' };
  }
  return readJson(response);
}

function rejectedWithoutRequest(
  failure: BotVerificationFailure,
): BotVerificationResult {
  return { ok: false, failure, errorCodes: [] };
}

async function classify(
  options: TurnstileVerifierOptions,
  expectedHostnames: readonly string[],
  input: BotVerificationInput,
): Promise<BotVerificationResult> {
  const { token } = input;
  if (token === undefined || token === '') {
    return rejectedWithoutRequest('missing-token');
  }
  if (token.length > MAX_TOKEN_LENGTH) {
    return rejectedWithoutRequest('invalid-token');
  }
  const outcome = await requestSiteverify(options, token, input.remoteIp);
  const expectations: VerificationExpectations = {
    hostnames: expectedHostnames,
    ...(input.expectedAction !== undefined && {
      action: input.expectedAction,
    }),
  };
  return interpretSiteverify(outcome, expectations);
}

function toAppError(failure: BotVerificationFailure): AppError {
  if (UNAVAILABLE_FAILURES.has(failure)) {
    return new AppError({
      kind: 'unavailable',
      code: 'bot_verification_unavailable',
      message: BOT_VERIFICATION_UNAVAILABLE_MESSAGE,
      retryAfterSeconds: UNAVAILABLE_RETRY_AFTER_SECONDS,
    });
  }
  return new AppError({
    kind: 'forbidden',
    code: 'bot_verification_failed',
    message: BOT_VERIFICATION_FAILED_MESSAGE,
  });
}

export function createTurnstileVerifier(
  options: TurnstileVerifierOptions,
): BotVerifier {
  // 判定サービスが返すホスト名はブラウザが小文字にそろえた値のため、設定値も小文字で照合する
  const expectedHostnames = options.expectedHostnames.map((hostname) =>
    hostname.toLowerCase(),
  );

  const verify = async (
    input: BotVerificationInput,
  ): Promise<BotVerificationResult> => {
    const result = await classify(options, expectedHostnames, input);
    if (!result.ok) {
      logger.warn('bot判定の検証に失敗しました', {
        failure: result.failure,
        errorCodes: result.errorCodes,
      });
    }
    return result;
  };

  return {
    verify,
    async assertHuman(input) {
      const result = await verify(input);
      if (result.ok) {
        return;
      }
      if (result.failure === 'misconfigured') {
        captureMessage(MISCONFIGURED_REPORT_MESSAGE, {
          level: 'error',
          extra: { errorCodes: result.errorCodes },
        });
      }
      throw toAppError(result.failure);
    },
  };
}
