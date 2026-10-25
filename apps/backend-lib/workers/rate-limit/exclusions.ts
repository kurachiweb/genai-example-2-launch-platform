export type RateLimitExclusion<E> = (request: Request, env: E) => boolean;

// 区切りの無い前方一致(例: /webhooks/stripe-other)で制限が外れないように、経路の区切りで一致を判定する
function matchesPathPrefix(pathname: string, pathPrefix: string): boolean {
  if (pathPrefix.endsWith('/')) {
    return pathname.startsWith(pathPrefix);
  }
  return pathname === pathPrefix || pathname.startsWith(`${pathPrefix}/`);
}

export function excludePath<E>(
  pathPrefix: string,
  method?: string,
): RateLimitExclusion<E> {
  if (!pathPrefix.startsWith('/')) {
    throw new RangeError(
      `除外する経路の接頭辞はスラッシュで始めてください: ${JSON.stringify(pathPrefix)}`,
    );
  }
  const expectedMethod = method?.toUpperCase();
  return (request) =>
    (expectedMethod === undefined || request.method === expectedMethod) &&
    matchesPathPrefix(new URL(request.url).pathname, pathPrefix);
}

export function excludeHostname<E>(
  hostname: (env: E) => string | undefined,
): RateLimitExclusion<E> {
  return (request, env) => {
    const expected = hostname(env)?.toLowerCase();
    return (
      expected !== undefined &&
      expected !== '' &&
      new URL(request.url).hostname === expected
    );
  };
}
