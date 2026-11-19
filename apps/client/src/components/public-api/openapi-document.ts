export type OpenApiDocument = Readonly<Record<string, unknown>>;

const PUBLIC_API_BASE_PATH = '/v1';

const ABSOLUTE_URL_PATTERN = /^(?:[a-z][a-z\d+.-]*:)?\/\//i;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const openApiDocumentUrl = (publicApiOrigin: string): string =>
  `${publicApiOrigin}${PUBLIC_API_BASE_PATH}/openapi.json`;

// 仕様書のサーバーのURLは仕様書の位置からの相対で書かれるが、Swagger UIへは仕様書をURLでなく値で渡すため、ページのオリジンではなく公開APIのオリジンへ要求を送れるよう絶対URLにする
const toAbsoluteServer = (server: unknown, documentUrl: string): unknown => {
  if (!isRecord(server) || typeof server.url !== 'string') {
    return server;
  }
  if (ABSOLUTE_URL_PATTERN.test(server.url)) {
    return server;
  }
  return { ...server, url: new URL(server.url, documentUrl).href };
};

export const withAbsoluteServers = (
  document: OpenApiDocument,
  publicApiOrigin: string,
): OpenApiDocument => {
  const { servers } = document;
  if (!Array.isArray(servers) || servers.length === 0) {
    return {
      ...document,
      servers: [{ url: `${publicApiOrigin}${PUBLIC_API_BASE_PATH}` }],
    };
  }
  const documentUrl = openApiDocumentUrl(publicApiOrigin);
  return {
    ...document,
    servers: servers.map((server: unknown) =>
      toAbsoluteServer(server, documentUrl),
    ),
  };
};

// 公開APIはCookieで認証しないため、別のオリジンへ資格情報を送らない
export const fetchOpenApiDocument = async (
  publicApiOrigin: string,
  signal?: AbortSignal,
): Promise<OpenApiDocument> => {
  const response = await fetch(openApiDocumentUrl(publicApiOrigin), {
    credentials: 'omit',
    headers: { Accept: 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) {
    throw new Error(
      `仕様書を取得できませんでした(状態コード${String(response.status)})。`,
    );
  }
  const document: unknown = await response.json();
  if (!isRecord(document)) {
    throw new Error('仕様書の形式が正しくありません。');
  }
  return document;
};
