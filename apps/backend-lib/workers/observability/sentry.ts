import { type CloudflareOptions, withSentry } from '@sentry/cloudflare';
import { sentry } from '@sentry/hono/cloudflare';
import type { Env, Hono, MiddlewareHandler } from 'hono';

import { AppError } from '../../core/errors/app-error.ts';
import { scrubEvent, scrubSpan } from '../../core/observability/scrub-event.ts';

export interface SentryRuntimeOptions {
  readonly dsn: string | undefined;
  readonly environment: string;
  readonly tracesSampleRate: number;
}

// Honoの計装は環境の検証より前に動くため、変数が欠けた環境も受け取る
export interface SentryEnv {
  readonly SENTRY_DSN?: string | undefined;
  readonly SENTRY_ENVIRONMENT?: string | undefined;
  readonly SENTRY_TRACES_SAMPLE_RATE?: string | undefined;
}

export type SentryOptionsFactory<E> = (env: E) => CloudflareOptions;

const UNKNOWN_ENVIRONMENT = 'unknown';

type DataCollection = NonNullable<CloudflareOptions['dataCollection']>;

// SDKの既定は利用者の情報・Cookie・ヘッダー・本文などを全て集め、除去処理はスパンの属性のキーを消さないため、SDKの段階で集めない
const DATA_COLLECTION: DataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};

function parseTracesSampleRate(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return 0;
  }
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 0;
}

export function readSentryRuntimeOptions(env: SentryEnv): SentryRuntimeOptions {
  const dsn = env.SENTRY_DSN === '' ? undefined : env.SENTRY_DSN;
  const environment =
    env.SENTRY_ENVIRONMENT === undefined || env.SENTRY_ENVIRONMENT === ''
      ? UNKNOWN_ENVIRONMENT
      : env.SENTRY_ENVIRONMENT;
  return {
    dsn,
    environment,
    tracesSampleRate: parseTracesSampleRate(env.SENTRY_TRACES_SAMPLE_RATE),
  };
}

export function buildSentryOptions(
  runtime: SentryRuntimeOptions,
): CloudflareOptions {
  return {
    dsn: runtime.dsn,
    enabled: runtime.dsn !== undefined,
    environment: runtime.environment,
    tracesSampleRate: runtime.tracesSampleRate,
    dataCollection: {
      ...DATA_COLLECTION,
      httpBodies: [...(DATA_COLLECTION.httpBodies ?? [])],
    },
    beforeSend: scrubEvent,
    beforeSendSpan: scrubSpan,
  };
}

function isUnexpectedError(error: unknown): boolean {
  return !(error instanceof AppError);
}

// app.fetchを計装済みのものに差し替えるため、Honoのアプリのfetchは他の計装で包まない
export function createSentryMiddleware<E extends Env>(
  app: Hono<E>,
  options: SentryOptionsFactory<E['Bindings']>,
): MiddlewareHandler {
  return sentry(app, (env) => ({
    ...options(env),
    shouldHandleError: isUnexpectedError,
  }));
}

export function withSentryForScheduledAndQueue<E, Q = unknown>(
  options: SentryOptionsFactory<E>,
  handler: ExportedHandler<E, Q>,
): ExportedHandler<E, Q> {
  const { scheduled, queue } = handler;
  const instrumented = withSentry<E, Q, unknown, ExportedHandler<E, Q>>(
    options,
    {
      ...(scheduled && { scheduled }),
      ...(queue && { queue }),
    },
  );
  return {
    ...handler,
    ...(instrumented.scheduled && { scheduled: instrumented.scheduled }),
    ...(instrumented.queue && { queue: instrumented.queue }),
  };
}
