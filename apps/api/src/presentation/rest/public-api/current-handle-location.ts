const HANDLE_SEGMENT = ':handle';

// 経路のパターンでハンドルの変数の位置を決め、同じ文字列の他の区画を置き換えないようにする
export function currentHandleLocation(input: {
  readonly requestUrl: string;
  readonly routePath: string;
  readonly handle: string;
}): string {
  const url = new URL(input.requestUrl);
  const patternSegments = input.routePath.split('/');
  const pathSegments = url.pathname.split('/');
  const index = patternSegments.indexOf(HANDLE_SEGMENT);
  if (index === -1 || patternSegments.length !== pathSegments.length) {
    throw new TypeError(
      `経路${input.routePath}から要求のパスのハンドルの位置を決められません。`,
    );
  }
  url.pathname = pathSegments
    .map((segment, position) =>
      position === index ? encodeURIComponent(input.handle) : segment,
    )
    .join('/');
  return url.href;
}
