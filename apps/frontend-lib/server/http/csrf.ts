import { isServerFunctionCall, SAFE_METHODS } from './page-request.ts';

export type CsrfRejectReason =
  'missing_headers' | 'cross_site_fetch' | 'origin_mismatch';

export type CsrfVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: CsrfRejectReason };

const ALLOWED_FETCH_SITE = 'same-origin';

const isSafeMethod = (method: string): boolean =>
  (SAFE_METHODS as ReadonlySet<string>).has(method);

export function requiresCsrfCheck(request: Request, url: URL): boolean {
  return !isSafeMethod(request.method) || isServerFunctionCall(url);
}

const allowed: CsrfVerdict = Object.freeze({ allowed: true });

const rejected = (reason: CsrfRejectReason): CsrfVerdict =>
  Object.freeze({ allowed: false, reason });

export function verifyCsrf(request: Request): CsrfVerdict {
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite !== null) {
    return fetchSite === ALLOWED_FETCH_SITE
      ? allowed
      : rejected('cross_site_fetch');
  }
  const origin = request.headers.get('Origin');
  if (origin === null) {
    // NFR-SECUR-003はRefererによる代わりの判定を認めないため、Refererがあってもヘッダーの欠落として拒否する
    return rejected('missing_headers');
  }
  // ブラウザはOriginを正規化した表記で送るため、表記の揺れ(大文字・既定のポート・末尾のスラッシュ・null)は正規化せず不一致として拒否する
  return origin === new URL(request.url).origin
    ? allowed
    : rejected('origin_mismatch');
}
