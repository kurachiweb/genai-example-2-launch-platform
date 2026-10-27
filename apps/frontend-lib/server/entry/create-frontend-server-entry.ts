import { resolveRequestDisplayPreferences } from '../display/request-display-preferences.ts';
import {
  type FrontendLogLevel,
  toPublicRuntimeConfig,
  type ValidatedFrontendEnv,
  validateFrontendEnv,
} from '../env/frontend-env.ts';
import { resolveClientIp } from '../http/client-ip.ts';
import { requiresCsrfCheck, verifyCsrf } from '../http/csrf.ts';
import {
  errorEnvelopeResponse,
  renderStaticErrorPage,
} from '../http/error-responses.ts';
import { checkIpRateLimit } from '../http/ip-rate-limit.ts';
import { generateNonce } from '../http/nonce.ts';
import { isPageRequest } from '../http/page-request.ts';
import {
  applySecurityHeaders,
  type SecurityHeadersInput,
} from '../http/security-headers.ts';
import {
  BASE_SECURITY_POLICY_SOURCES,
  buildPageContentSecurityPolicy,
  buildPermissionsPolicy,
  mergeSecurityPolicySources,
  NON_PAGE_CONTENT_SECURITY_POLICY,
  runtimeSecurityPolicySources,
  type SecurityPolicySources,
} from '../http/security-policy.ts';
import {
  type AccessLogRecord,
  ensureFrontendLoggingConfigured,
  getFrontendLogger,
  logAccess,
  withCorrelationId,
} from '../observability/logging.ts';
import { RELAY_PATH_PREFIX } from '../relay/relay-contract.ts';
import { createRelayContext } from '../relay/relay-headers.ts';
import {
  findRelayRoute,
  type RelayRoute,
  relayToApi,
} from '../relay/relay-route.ts';
import type { FrontendAppProfile } from './app-profile.ts';
import type { FrontendRequestContext } from './request-context.ts';

export interface StartHandler {
  fetch(
    request: Request,
    options: { readonly context: FrontendRequestContext },
  ): Promise<Response>;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface FrontendFetchHandler {
  fetch(
    request: Request,
    env: unknown,
    ctx: ExecutionContextLike,
  ): Promise<Response>;
}

export interface FrontendServerEntryOptions {
  readonly profile: FrontendAppProfile;
  readonly startHandler: StartHandler;
  readonly relayRoutes: readonly RelayRoute[];
  readonly securityPolicy: SecurityPolicySources;
  // アプリが@sentry/cloudflareのcaptureExceptionを渡す
  readonly reportUnexpected: (error: unknown) => void;
  // アプリがSentry.getTraceDataを渡す
  readonly traceHeaders: () => Readonly<Record<string, string>>;
  readonly console?: Console;
  readonly now?: () => number;
}

type Outcome = AccessLogRecord['outcome'];

interface Handled {
  readonly response: Response;
  readonly outcome: Outcome;
  readonly security: SecurityHeadersInput;
}

interface ResponseSecurity {
  readonly page: SecurityHeadersInput;
  readonly nonPage: SecurityHeadersInput;
}

interface ValidRequest {
  readonly options: FrontendServerEntryOptions;
  readonly request: Request;
  readonly url: URL;
  readonly env: ValidatedFrontendEnv;
  readonly correlationId: string;
  readonly nonce: string;
  readonly security: ResponseSecurity;
}

const FALLBACK_LOG_LEVEL: FrontendLogLevel = 'info';

const HTML_MEDIA_TYPE = 'text/html';

// 環境の値から組み立てる許可先と、その元のキーの対応
const RUNTIME_POLICY_ENV_NAMES = {
  imgSrc: 'IMAGES_ORIGIN',
  connectSrc: 'SENTRY_DSN',
} as const satisfies Partial<Record<keyof SecurityPolicySources, string>>;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

// 不正な値はensureFrontendLoggingConfiguredがinfoとして扱い、続く環境の検証が要求を失敗させる
const requestedLogLevel = (env: unknown): FrontendLogLevel => {
  const level = isRecord(env) ? env['LOG_LEVEL'] : undefined;
  return typeof level === 'string'
    ? (level as FrontendLogLevel)
    : FALLBACK_LOG_LEVEL;
};

const readCfTimeZone = (request: Request): unknown => {
  const cf: unknown = Reflect.get(request, 'cf');
  return isRecord(cf) ? cf['timezone'] : undefined;
};

const isHtmlResponse = (response: Response): boolean =>
  response.headers
    .get('Content-Type')
    ?.toLowerCase()
    .startsWith(HTML_MEDIA_TYPE) ?? false;

const acceptsPolicySources = (sources: SecurityPolicySources): boolean => {
  try {
    mergeSecurityPolicySources(sources);
    return true;
  } catch {
    return false;
  }
};

// 例外のメッセージには値が入るため、どのキーの値が許可先として使えないかだけを求める
const invalidPolicyEnvNames = (
  runtime: SecurityPolicySources,
): readonly string[] =>
  Object.entries(RUNTIME_POLICY_ENV_NAMES).flatMap(([directive, name]) =>
    acceptsPolicySources({
      [directive]: runtime[directive as keyof typeof RUNTIME_POLICY_ENV_NAMES],
    })
      ? []
      : [name],
  );

// 例外や環境の不備の時は許可先を組み立て直さず、最も狭いCSPとPermissions-Policyを付ける。静的なエラー画面は<style>が遮断されてもcolor-schemeで読める
const failureSecurity = (): SecurityHeadersInput => ({
  contentSecurityPolicy: NON_PAGE_CONTENT_SECURITY_POLICY,
  permissionsPolicy: buildPermissionsPolicy({}),
  noIndex: true,
});

const envFailure = (
  options: FrontendServerEntryOptions,
  invalidEnvNames: readonly string[],
): Handled => {
  // 属性名にkeyを含めると、属性名による伏せ字で値ごと伏せられる
  getFrontendLogger([options.profile.caller, 'env']).error(
    '環境の設定に不備があるため要求を処理しません',
    { invalidEnvNames },
  );
  options.reportUnexpected(
    new Error(`環境の設定に不備があります: ${invalidEnvNames.join(', ')}`),
  );
  return {
    response: renderStaticErrorPage({ status: 500 }),
    outcome: 'static_error',
    security: failureSecurity(),
  };
};

const buildResponseSecurity = (
  options: FrontendServerEntryOptions,
  env: ValidatedFrontendEnv,
  runtime: SecurityPolicySources,
  nonce: string,
): ResponseSecurity => {
  const sources = mergeSecurityPolicySources(
    BASE_SECURITY_POLICY_SOURCES,
    options.securityPolicy,
    runtime,
  );
  const permissionsPolicy = buildPermissionsPolicy(sources);
  const noIndex = !options.profile.indexable(env.APP_ENVIRONMENT);
  return {
    page: {
      contentSecurityPolicy: buildPageContentSecurityPolicy({
        nonce,
        sources,
        // ローカルの画像配信はhttpのため、格上げすると読めなくなる
        upgradeInsecureRequests: env.APP_ENVIRONMENT !== 'local',
      }),
      permissionsPolicy,
      noIndex,
    },
    nonPage: {
      contentSecurityPolicy: NON_PAGE_CONTENT_SECURITY_POLICY,
      permissionsPolicy,
      noIndex,
    },
  };
};

const rateLimited = async (
  valid: ValidRequest,
): Promise<Handled | undefined> => {
  const { options, request, url, env, security } = valid;
  const logger = getFrontendLogger([
    options.profile.caller,
    'http',
    'rate-limit',
  ]);
  const outcome = await checkIpRateLimit(
    env.IP_RATE_LIMITER,
    resolveClientIp(request),
    logger,
  );
  if (outcome.allowed) {
    return undefined;
  }
  logger.warn('IP制限の上限を超えたため要求を拒否しました', {
    path: url.pathname,
  });
  const { retryAfterSeconds } = outcome;
  return isPageRequest(request)
    ? {
        response: renderStaticErrorPage({ status: 429, retryAfterSeconds }),
        outcome: 'rejected',
        security: security.page,
      }
    : {
        response: errorEnvelopeResponse({
          status: 429,
          code: 'rate_limit_exceeded',
          retryAfterSeconds,
        }),
        outcome: 'rejected',
        security: security.nonPage,
      };
};

const csrfRejected = (valid: ValidRequest): Handled | undefined => {
  const { options, request, url, security } = valid;
  if (!requiresCsrfCheck(request, url)) {
    return undefined;
  }
  const verdict = verifyCsrf(request);
  if (verdict.allowed) {
    return undefined;
  }
  getFrontendLogger([options.profile.caller, 'http', 'csrf']).warn(
    'CSRFの検証で要求を拒否しました',
    { reason: verdict.reason, path: url.pathname },
  );
  return {
    response: errorEnvelopeResponse({ status: 403, code: 'csrf_rejected' }),
    outcome: 'rejected',
    security: security.nonPage,
  };
};

const dispatch = async (valid: ValidRequest): Promise<Handled> => {
  const { options, request, url, env, security } = valid;
  const { profile } = options;
  const relay = createRelayContext(request, profile, options.traceHeaders());
  if (url.pathname.startsWith(RELAY_PATH_PREFIX)) {
    const route = findRelayRoute(options.relayRoutes, url);
    if (route === undefined) {
      return {
        response: errorEnvelopeResponse({ status: 404, code: 'not_found' }),
        outcome: 'rejected',
        security: security.nonPage,
      };
    }
    return {
      response: await relayToApi(route, request, {
        api: env.API,
        context: relay,
        cookieName: profile.sessionCookieName,
        logger: getFrontendLogger([profile.caller, 'relay']),
        sessionLogger: getFrontendLogger([profile.caller, 'relay', 'session']),
        reportUnexpected: options.reportUnexpected,
      }),
      outcome: 'relay',
      security: security.nonPage,
    };
  }
  const context: FrontendRequestContext = {
    nonce: valid.nonce,
    correlationId: valid.correlationId,
    display: resolveRequestDisplayPreferences({
      cfTimeZone: readCfTimeZone(request),
      acceptLanguage: request.headers.get('Accept-Language'),
    }),
    publicConfig: toPublicRuntimeConfig(env, profile),
    relay,
    api: env.API,
    sessionCookieName: profile.sessionCookieName,
  };
  const response = await options.startHandler.fetch(request, { context });
  return {
    response,
    outcome: 'page',
    security: isHtmlResponse(response) ? security.page : security.nonPage,
  };
};

// 処理の順序の唯一の定義。環境の検証をIP制限より前に置くのは、バインディングが無い状態でIP制限を呼ばないため
const handle = async (
  options: FrontendServerEntryOptions,
  request: Request,
  rawEnv: unknown,
  correlationId: string,
): Promise<Handled> => {
  const validation = validateFrontendEnv(rawEnv);
  if (!validation.ok) {
    return envFailure(options, validation.invalidKeys);
  }
  const { env } = validation;
  const runtime = runtimeSecurityPolicySources(env);
  const invalidNames = invalidPolicyEnvNames(runtime);
  if (invalidNames.length > 0) {
    return envFailure(options, invalidNames);
  }
  const nonce = generateNonce();
  const valid: ValidRequest = {
    options,
    request,
    url: new URL(request.url),
    env,
    correlationId,
    nonce,
    security: buildResponseSecurity(options, env, runtime, nonce),
  };
  return (
    (await rateLimited(valid)) ?? csrfRejected(valid) ?? (await dispatch(valid))
  );
};

const handleSafely = async (
  options: FrontendServerEntryOptions,
  request: Request,
  rawEnv: unknown,
  correlationId: string,
): Promise<Handled> => {
  try {
    return await handle(options, request, rawEnv, correlationId);
  } catch (error) {
    getFrontendLogger([options.profile.caller, 'http', 'error']).error(
      '想定外の例外が発生しました',
      { error },
    );
    options.reportUnexpected(error);
    return {
      response: renderStaticErrorPage({ status: 500 }),
      outcome: 'static_error',
      security: failureSecurity(),
    };
  }
};

// 送信の失敗で応答のヘッダーとアクセスログを失わないよう、送信の例外はここで止める。送信の例外のメッセージは送れなかった元の例外の値を含み得るため、名前だけを記録する
const guardReporter =
  (caller: FrontendAppProfile['caller'], report: (error: unknown) => void) =>
  (error: unknown): void => {
    try {
      report(error);
    } catch (reportError) {
      getFrontendLogger([caller, 'http', 'error']).error(
        '想定外の失敗をエラートラッキングへ送れませんでした',
        {
          errorName:
            reportError instanceof Error
              ? reportError.name
              : typeof reportError,
        },
      );
    }
  };

export function createFrontendServerEntry(
  entryOptions: FrontendServerEntryOptions,
): FrontendFetchHandler {
  const { caller } = entryOptions.profile;
  const options: FrontendServerEntryOptions = {
    ...entryOptions,
    reportUnexpected: guardReporter(caller, entryOptions.reportUnexpected),
  };
  const now = options.now ?? Date.now;
  return {
    fetch: (request, rawEnv) => {
      const startedAt = now();
      // 設定より前に作った文脈は相関IDを保てないため、文脈を作る前に設定する
      ensureFrontendLoggingConfigured({
        caller,
        level: requestedLogLevel(rawEnv),
        ...(options.console === undefined ? {} : { console: options.console }),
      });
      const correlationId = crypto.randomUUID();
      return withCorrelationId(correlationId, async () => {
        const handled = await handleSafely(
          options,
          request,
          rawEnv,
          correlationId,
        );
        const response = applySecurityHeaders(
          handled.response,
          handled.security,
        );
        logAccess(caller, {
          method: request.method,
          path: new URL(request.url).pathname,
          status: response.status,
          durationMs: now() - startedAt,
          correlationId,
          outcome: handled.outcome,
        });
        return response;
      });
    },
  };
}
