// apps/backend-libのworkers/http/security-headers.tsのSECURITY_HEADERSのうちPermissions-Policy以外の写し。一致はルートのconfig/contract-copies.unit.test.tsが確かめる
export const BASE_SECURITY_HEADERS = Object.freeze({
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
} as const);

export interface SecurityHeadersInput {
  readonly contentSecurityPolicy: string;
  readonly permissionsPolicy: string;
  readonly noIndex: boolean;
}

const setSecurityHeaders = (
  headers: Headers,
  input: SecurityHeadersInput,
): void => {
  for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  headers.set('Content-Security-Policy', input.contentSecurityPolicy);
  headers.set('Permissions-Policy', input.permissionsPolicy);
  headers.set('Cache-Control', 'no-store');
  if (input.noIndex) {
    headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
};

export const applySecurityHeaders = (
  response: Response,
  input: SecurityHeadersInput,
): Response => {
  try {
    setSecurityHeaders(response.headers, input);
    return response;
  } catch (error) {
    // fetchの結果やResponse.redirectの応答はヘッダーが不変で、書き換えるとTypeErrorになる
    if (!(error instanceof TypeError)) {
      throw error;
    }
    const copy = new Response(response.body, response);
    setSecurityHeaders(copy.headers, input);
    return copy;
  }
};
