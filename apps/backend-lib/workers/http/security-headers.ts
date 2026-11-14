export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze(
  {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': [
      'accelerometer=()',
      'autoplay=()',
      'camera=()',
      'display-capture=()',
      'encrypted-media=()',
      'fullscreen=()',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'midi=()',
      'payment=()',
      'publickey-credentials-get=()',
      'screen-wake-lock=()',
      'usb=()',
      'xr-spatial-tracking=()',
    ].join(', '),
  },
);

export const DEFAULT_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const CONTENT_SECURITY_POLICY_HEADER = 'Content-Security-Policy';

function setSecurityHeaders(headers: Headers): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  if (!headers.has(CONTENT_SECURITY_POLICY_HEADER)) {
    headers.set(
      CONTENT_SECURITY_POLICY_HEADER,
      DEFAULT_CONTENT_SECURITY_POLICY,
    );
  }
}

export function applySecurityHeaders(response: Response): Response {
  try {
    setSecurityHeaders(response.headers);
    return response;
  } catch (error) {
    // fetchの結果やResponse.redirectの応答はヘッダーが不変で、書き換えるとTypeErrorになる
    if (!(error instanceof TypeError)) {
      throw error;
    }
    const copy = new Response(response.body, response);
    setSecurityHeaders(copy.headers);
    return copy;
  }
}

export function withSecurityHeaders<E, Q = unknown>(
  handler: ExportedHandler<E, Q>,
): ExportedHandler<E, Q> {
  const { fetch: handleFetch } = handler;
  if (handleFetch === undefined) {
    return handler;
  }
  return {
    ...handler,
    fetch: async (request, env, ctx) =>
      applySecurityHeaders(await handleFetch(request, env, ctx)),
  };
}
