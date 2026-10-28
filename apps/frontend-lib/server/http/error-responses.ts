import {
  UNEXPECTED_ERROR_MESSAGE,
  UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT,
} from '../../utilities/messages/state-messages.ts';

const STATUS_BY_CODE = Object.freeze({
  rate_limit_exceeded: 429,
  csrf_rejected: 403,
  not_found: 404,
  method_not_allowed: 405,
  unsupported_media_type: 415,
  upstream_unavailable: 503,
  upstream_timeout: 503,
  internal_error: 500,
} as const);

export type FrontendErrorCode = keyof typeof STATUS_BY_CODE;

export const RATE_LIMIT_MESSAGE =
  '操作が集中しています。しばらく待ってから再度お試しください。';

export { UNEXPECTED_ERROR_MESSAGE, UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT };

const REJECTED_OPERATION_MESSAGE =
  'この操作を受け付けられませんでした。ページを再読み込みして再度お試しください。';

const UNAVAILABLE_MESSAGE =
  '現在ご利用いただけません。時間をおいて再度お試しください。';

export const ERROR_MESSAGES: Readonly<Record<FrontendErrorCode, string>> =
  Object.freeze({
    rate_limit_exceeded: RATE_LIMIT_MESSAGE,
    csrf_rejected: REJECTED_OPERATION_MESSAGE,
    not_found: 'お探しの内容は見つかりませんでした。',
    method_not_allowed: REJECTED_OPERATION_MESSAGE,
    unsupported_media_type: REJECTED_OPERATION_MESSAGE,
    upstream_unavailable: UNAVAILABLE_MESSAGE,
    upstream_timeout: UNAVAILABLE_MESSAGE,
    internal_error: '問題が発生しました。時間をおいて再度お試しください。',
  });

type StatusOf<C extends FrontendErrorCode> = (typeof STATUS_BY_CODE)[C];

type RetryableCode = {
  [C in FrontendErrorCode]: StatusOf<C> extends 429 | 503 ? C : never;
}[FrontendErrorCode];

export type ErrorEnvelopeInput =
  | {
      readonly status: StatusOf<RetryableCode>;
      readonly code: RetryableCode;
      readonly retryAfterSeconds?: number;
    }
  | {
      readonly status: 405;
      readonly code: 'method_not_allowed';
      readonly allow: readonly string[];
    }
  | {
      [C in Exclude<FrontendErrorCode, RetryableCode | 'method_not_allowed'>]: {
        readonly status: StatusOf<C>;
        readonly code: C;
      };
    }[Exclude<FrontendErrorCode, RetryableCode | 'method_not_allowed'>];

export type StaticErrorPageInput =
  | { readonly status: 429; readonly retryAfterSeconds?: number }
  | { readonly status: 500; readonly contactAvailable: boolean };

// RFC 9110のtokenの文字だけを許し、区切りの「,」や改行を含むメソッド名でAllowの一覧が壊れるのを防ぐ
const METHOD_TOKEN_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;

const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 503]);

const readOptional = (input: object, key: string): unknown =>
  key in input ? (input as Readonly<Record<string, unknown>>)[key] : undefined;

const validRetryAfterSeconds = (
  status: number,
  value: unknown,
): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!RETRYABLE_STATUSES.has(status)) {
    throw new RangeError(
      `再試行までの秒数は429と503にだけ指定できます: ${String(status)}`,
    );
  }
  // Retry-Afterの秒数(delay-seconds)は0以上の整数だけを表せる
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `再試行までの秒数は0以上の整数で指定してください: ${typeof value === 'number' ? String(value) : typeof value}`,
    );
  }
  return value;
};

const validAllow = (status: number, value: unknown): string | undefined => {
  if (status !== 405) {
    if (value !== undefined) {
      throw new RangeError(`Allowは405にだけ指定できます: ${String(status)}`);
    }
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new RangeError('405にはAllowのメソッドを1つ以上指定してください');
  }
  for (const method of value) {
    if (typeof method !== 'string' || !METHOD_TOKEN_PATTERN.test(method)) {
      throw new RangeError(
        `Allowのメソッド名が不正です: ${JSON.stringify(method)}`,
      );
    }
  }
  return value.join(', ');
};

const baseHeaders = (
  contentType: string,
  retryAfterSeconds: number | undefined,
): Headers => {
  const headers = new Headers({
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  if (retryAfterSeconds !== undefined) {
    headers.set('Retry-After', String(retryAfterSeconds));
  }
  return headers;
};

export function errorEnvelopeResponse(input: ErrorEnvelopeInput): Response {
  const { status, code } = input;
  if (STATUS_BY_CODE[code] !== status) {
    throw new RangeError(
      `エラーコードと状態コードが対応しません: ${code} ${String(status)}`,
    );
  }
  const retryAfterSeconds = validRetryAfterSeconds(
    status,
    readOptional(input, 'retryAfterSeconds'),
  );
  const allow = validAllow(status, readOptional(input, 'allow'));

  const headers = baseHeaders('application/json', retryAfterSeconds);
  if (allow !== undefined) {
    headers.set('Allow', allow);
  }
  const body = { error: { code, message: ERROR_MESSAGES[code] } };
  return new Response(JSON.stringify(body), { status, headers });
}

// ページのCSPでも、style要素を拒否するページ以外のCSPでも読めるよう、外部のファイルとスクリプトを使わず、明暗はスタイルが無くてもmeta要素のcolor-schemeでOSの設定に従わせる
const STATIC_ERROR_PAGE_STYLE = [
  ':root{color-scheme:light dark;background:oklch(0.985 0.006 150);color:oklch(0.2 0.03 160);font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI","Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic UI",Meiryo,sans-serif}',
  '@media (prefers-color-scheme: dark){:root{background:oklch(0.15 0.02 160);color:oklch(0.96 0.01 150)}}',
  'body{margin:0}',
  'main{box-sizing:border-box;max-width:40rem;margin:0 auto;padding:4rem 1rem}',
  'h1{margin:0;font-size:1.125rem;font-weight:600;line-height:1.75}',
].join('');

const staticErrorMessageOf = (input: StaticErrorPageInput): string => {
  if (input.status === 429) {
    return RATE_LIMIT_MESSAGE;
  }
  return input.contactAvailable
    ? UNEXPECTED_ERROR_MESSAGE
    : UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT;
};

const staticErrorPageHtml = (message: string): string =>
  [
    '<!doctype html>',
    '<html lang="ja">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    `<title>${message}</title>`,
    `<style>${STATIC_ERROR_PAGE_STYLE}</style>`,
    '</head>',
    '<body>',
    `<main><h1>${message}</h1></main>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');

export function renderStaticErrorPage(input: StaticErrorPageInput): Response {
  const { status } = input;
  const retryAfterSeconds = validRetryAfterSeconds(
    status,
    readOptional(input, 'retryAfterSeconds'),
  );

  return new Response(staticErrorPageHtml(staticErrorMessageOf(input)), {
    status,
    headers: baseHeaders('text/html; charset=utf-8', retryAfterSeconds),
  });
}
