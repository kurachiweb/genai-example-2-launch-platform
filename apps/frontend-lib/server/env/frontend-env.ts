import { z } from '../../utilities/validation/zod.ts';
import type {
  AppEnvironment,
  FrontendAppProfile,
} from '../entry/app-profile.ts';

export interface ServiceFetcher {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

export interface RateLimiter {
  limit(options: {
    readonly key: string;
  }): Promise<{ readonly success: boolean }>;
}

export type FrontendLogLevel = 'debug' | 'info' | 'warning' | 'error';

export interface ValidatedFrontendEnv {
  readonly API: ServiceFetcher;
  readonly IP_RATE_LIMITER: RateLimiter;
  readonly APP_ENVIRONMENT: AppEnvironment;
  readonly LOG_LEVEL: FrontendLogLevel;
  readonly SENTRY_ENVIRONMENT: string;
  readonly SENTRY_TRACES_SAMPLE_RATE: number;
  readonly SENTRY_DSN: string | undefined;
  readonly TURNSTILE_SITE_KEY: string;
  readonly IMAGES_ORIGIN: string;
  readonly WEB_ANALYTICS_TOKEN: string | undefined;
}

export type EnvValidation =
  | { readonly ok: true; readonly env: ValidatedFrontendEnv }
  | { readonly ok: false; readonly invalidKeys: readonly string[] };

export interface PublicRuntimeConfig {
  readonly environment: AppEnvironment;
  readonly turnstileSiteKey: string;
  readonly sentry: {
    readonly dsn: string | undefined;
    readonly environment: string;
    readonly tracesSampleRate: number;
  };
  readonly webAnalyticsToken: string | undefined;
}

const APP_ENVIRONMENT_VALUES = {
  local: 'local',
  staging: 'staging',
  prod: 'prod',
} as const satisfies { readonly [K in AppEnvironment]: K };

const LOG_LEVEL_VALUES = {
  debug: 'debug',
  info: 'info',
  warning: 'warning',
  error: 'error',
} as const satisfies { readonly [K in FrontendLogLevel]: K };

// 0以上1以下の10進表記だけを受け付ける。Number()は空文字列・16進・指数表記も数値にするため使わない
const SAMPLE_RATE_PATTERN = /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/;

// workerdが注入するバインディングの実体は、呼び出す関数を持つことだけを確かめる
const hasMethod = (value: unknown, method: string): boolean =>
  (typeof value === 'object' || typeof value === 'function') &&
  value !== null &&
  typeof Reflect.get(value, method) === 'function';

const isOrigin = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === value
    );
  } catch {
    return false;
  }
};

const optionalText = z
  .string()
  .optional()
  .transform((value) => (value === '' ? undefined : value));

const frontendEnvSchema = z.object({
  API: z.custom<ServiceFetcher>((value) => hasMethod(value, 'fetch')),
  IP_RATE_LIMITER: z.custom<RateLimiter>((value) => hasMethod(value, 'limit')),
  APP_ENVIRONMENT: z.enum(APP_ENVIRONMENT_VALUES),
  LOG_LEVEL: z.enum(LOG_LEVEL_VALUES),
  SENTRY_ENVIRONMENT: z.string().min(1),
  SENTRY_TRACES_SAMPLE_RATE: z
    .string()
    .regex(SAMPLE_RATE_PATTERN)
    .transform(Number),
  SENTRY_DSN: optionalText,
  TURNSTILE_SITE_KEY: z.string().min(1),
  IMAGES_ORIGIN: z.string().refine(isOrigin),
  WEB_ANALYTICS_TOKEN: optionalText,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// Zodの問題には入力値が入り得るため、問題からはキー名だけを取り出し、問題そのものは保持しない
const keysOf = (issues: readonly z.core.$ZodIssue[]): readonly string[] =>
  Object.freeze(
    [
      ...new Set(
        issues.flatMap(({ path: [key] }) =>
          typeof key === 'string' ? [key] : [],
        ),
      ),
    ].toSorted(),
  );

export const validateFrontendEnv = (raw: unknown): EnvValidation => {
  const result = frontendEnvSchema.safeParse(isRecord(raw) ? raw : {});
  if (!result.success) {
    return { ok: false, invalidKeys: keysOf(result.error.issues) };
  }
  return { ok: true, env: result.data };
};

export const toPublicRuntimeConfig = (
  env: ValidatedFrontendEnv,
  profile: FrontendAppProfile,
): PublicRuntimeConfig => ({
  environment: env.APP_ENVIRONMENT,
  turnstileSiteKey: env.TURNSTILE_SITE_KEY,
  sentry: {
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
  },
  webAnalyticsToken: profile.webAnalytics ? env.WEB_ANALYTICS_TOKEN : undefined,
});
