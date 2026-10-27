export type EmailProviderOutcome =
  | { readonly kind: 'sent'; readonly providerMessageId: string }
  | { readonly kind: 'rate-limited' }
  | { readonly kind: 'daily-limit' }
  | { readonly kind: 'temporary'; readonly code: string }
  | { readonly kind: 'recipient-suppressed' }
  | { readonly kind: 'recipient-not-allowed' }
  | { readonly kind: 'permanent'; readonly code: string };

export type EmailProviderFailure = Exclude<
  EmailProviderOutcome,
  { kind: 'sent' }
>;

export const UNKNOWN_SEND_ERROR_CODE = 'unknown';

// バインディングのE_RECIPIENT_NOT_ALLOWEDは送信バインディングの設定の誤りであり、環境の宛先制限(recipient-not-allowed)とは別に扱う
const PERMANENT_CODES: ReadonlySet<string> = new Set([
  'E_VALIDATION_ERROR',
  'E_FIELD_MISSING',
  'E_CONTENT_TOO_LARGE',
  'E_HEADER_NOT_ALLOWED',
  'E_HEADER_USE_API_FIELD',
  'E_HEADER_VALUE_INVALID',
  'E_HEADER_VALUE_TOO_LONG',
  'E_HEADER_NAME_INVALID',
  'E_HEADERS_TOO_LARGE',
  'E_HEADERS_TOO_MANY',
  'E_SENDER_NOT_VERIFIED',
  'E_SENDER_DOMAIN_NOT_AVAILABLE',
  'E_RECIPIENT_NOT_ALLOWED',
  'E_ACCOUNT_SUSPENDED',
]);

const PERMANENT_CODE_PREFIX = 'E_TOO_MANY_';

// 再試行可否が公開されていないため、表に無いコードは再試行させ、試行回数の上限で送信不能として検知する
export function classifyCloudflareSendError(
  code: string | undefined,
): EmailProviderFailure {
  if (code === undefined) {
    return { kind: 'temporary', code: UNKNOWN_SEND_ERROR_CODE };
  }
  switch (code) {
    case 'E_RATE_LIMIT_EXCEEDED':
      return { kind: 'rate-limited' };
    case 'E_DAILY_LIMIT_EXCEEDED':
      return { kind: 'daily-limit' };
    case 'E_RECIPIENT_SUPPRESSED':
      return { kind: 'recipient-suppressed' };
  }
  if (PERMANENT_CODES.has(code) || code.startsWith(PERMANENT_CODE_PREFIX)) {
    return { kind: 'permanent', code };
  }
  return { kind: 'temporary', code };
}
