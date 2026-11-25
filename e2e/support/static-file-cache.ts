import { findImmutableCacheProblems } from './security-assertions.ts';

export interface StaticFile {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: Buffer;
}

export interface StaticFileCache {
  readonly get: (url: string) => StaticFile | undefined;
  readonly set: (url: string, file: StaticFile) => void;
}

// PlaywrightのResponseとRouteのうち使う部分だけを受ける
export interface StaticFileResponse {
  url(): string;
  status(): number;
  headers(): Record<string, string>;
  request(): { method(): string };
  body(): Promise<Buffer>;
}

export interface StaticFileRoute {
  request(): { url(): string; method(): string };
  fallback(): Promise<void>;
  fulfill(file: StaticFile): Promise<void>;
}

const STATIC_FILE_PATH_PREFIX = '/assets/';
const REUSABLE_METHOD = 'GET';
const REUSABLE_STATUS = 200;

// 応答の本文は復号した後の値で得られるため、転送時の形を表すヘッダーは本文と食い違う
const TRANSFER_HEADER_NAMES: ReadonlySet<string> = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
]);

export function createStaticFileCache(): StaticFileCache {
  const files = new Map<string, StaticFile>();
  return {
    get: (url) => files.get(url),
    set: (url, file) => {
      files.set(url, file);
    },
  };
}

export const isStaticFileUrl = (url: URL): boolean =>
  url.pathname.startsWith(STATIC_FILE_PATH_PREFIX);

const isReusable = (response: StaticFileResponse): boolean =>
  isStaticFileUrl(new URL(response.url())) &&
  response.request().method() === REUSABLE_METHOD &&
  response.status() === REUSABLE_STATUS &&
  findImmutableCacheProblems(response.headers()).length === 0;

const bodyOf = async (
  response: StaticFileResponse,
): Promise<Buffer | undefined> => {
  try {
    return await response.body();
  } catch {
    // テストの終わりにページが閉じると本文を読めない。覚えなければ次のテストが取り直すだけのため、失敗として扱わない
    return undefined;
  }
};

// 内容が変われば名前も変わるファイル(再検証なしの長期のキャッシュを許す応答)だけを覚える
export async function rememberStaticFile(
  cache: StaticFileCache,
  response: StaticFileResponse,
): Promise<void> {
  if (!isReusable(response) || cache.get(response.url()) !== undefined) {
    return;
  }
  const body = await bodyOf(response);
  if (body === undefined) {
    return;
  }
  const headers = Object.fromEntries(
    Object.entries(response.headers()).filter(
      ([name]) => !TRANSFER_HEADER_NAMES.has(name.toLowerCase()),
    ),
  );
  cache.set(response.url(), { status: response.status(), headers, body });
}

export async function replayStaticFile(
  cache: StaticFileCache,
  route: StaticFileRoute,
): Promise<void> {
  const request = route.request();
  const file =
    request.method() === REUSABLE_METHOD ? cache.get(request.url()) : undefined;
  await (file === undefined ? route.fallback() : route.fulfill(file));
}
