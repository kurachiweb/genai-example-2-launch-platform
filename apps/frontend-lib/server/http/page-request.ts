type SafeMethod = 'GET' | 'HEAD' | 'OPTIONS';

export const SAFE_METHODS: ReadonlySet<SafeMethod> = new Set<SafeMethod>([
  'GET',
  'HEAD',
  'OPTIONS',
]);

const PAGE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

const HTML_MEDIA_TYPE = 'text/html';

export function isPageRequest(request: Request): boolean {
  if (!PAGE_METHODS.has(request.method)) {
    return false;
  }
  const accept = request.headers.get('Accept');
  return accept?.toLowerCase().includes(HTML_MEDIA_TYPE) ?? false;
}

// TanStack StartはルーターのbasepathとserverFns.baseをつないだ経路を使う。どちらも既定値(/と/_serverFn)を前提とし、変えた場合はここも合わせる
export const SERVER_FUNCTION_PATH_PREFIX = '/_serverFn/';

const KEPT_ESCAPE_PATTERN = /(%25|%5C)/i;

const decodeEscapes = (part: string): string =>
  part.replaceAll(/%[0-9A-F]{2}/gi, (escape) => {
    try {
      return decodeURI(escape);
    } catch {
      return escape;
    }
  });

const decodePart = (part: string): string => {
  try {
    return decodeURI(part);
  } catch {
    return decodeEscapes(part);
  }
};

// TanStack Start(router-coreのdecodePath)と同じ手順で解除する。%25と%5Cはエンコードしたまま残し、その間の部分ごとに解除する
const decodePathname = (pathname: string): string =>
  pathname
    .split(KEPT_ESCAPE_PATTERN)
    .map((part, index) => (index % 2 === 1 ? part : decodePart(part)))
    .join('');

export function isServerFunctionCall(url: URL): boolean {
  // TanStack Startは解除後の経路でサーバー関数を判定するため、エンコードした経路でCSRFの検証を逃れないよう両方で比べる
  return [url.pathname, decodePathname(url.pathname)].some((pathname) =>
    pathname.startsWith(SERVER_FUNCTION_PATH_PREFIX),
  );
}
