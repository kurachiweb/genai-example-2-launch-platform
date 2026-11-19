import { CONNECTING_IP_HEADER, randomDocumentationIpv6 } from './client-ip.ts';
import { resolveLocalWorkerOrigin } from './local-worker-origins.ts';

export type SendRequest = (url: URL, init: RequestInit) => Promise<Response>;

export type PublicApiMethod = 'GET' | 'PUT' | 'PATCH';

export interface PublicApiRequest {
  readonly apiKey: string;
  // 公開REST APIの基準パスより後の経路(例: /products/rocket)
  readonly path: string;
  readonly method?: PublicApiMethod;
  readonly body?: unknown;
}

export interface PublicApiResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface PublicApiClient {
  readonly request: (request: PublicApiRequest) => Promise<PublicApiResponse>;
}

export interface PublicApiClientOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly clientIp?: string;
  readonly send?: SendRequest;
}

// apps/apiのpresentation/rest/public-api-app.tsのPUBLIC_API_BASE_PATHの写し。一致はルートのconfig/public-api-contract-copies.unit.test.tsが確かめる
export const PUBLIC_API_BASE_PATH = '/v1';

const JSON_MEDIA_TYPE = 'application/json';

export function publicApiOrigin(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return new URL(resolveLocalWorkerOrigin('api', env)).origin;
}

export function publicApiUrl(
  path: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): URL {
  if (!path.startsWith('/')) {
    throw new RangeError(`公開APIの経路はスラッシュで始めてください: ${path}`);
  }
  return new URL(`${PUBLIC_API_BASE_PATH}${path}`, publicApiOrigin(env));
}

const bodyOf = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text === '') {
    return null;
  }
  const contentType = response.headers.get('Content-Type') ?? '';
  return contentType.includes(JSON_MEDIA_TYPE) ? JSON.parse(text) : text;
};

// 公開APIのIPアドレス単位の制限は実行をまたいでローカルの状態に残り、ブラウザから仕様書を取得する他のテストとも同じ回数を数えるため、クライアントごとに別の接続元のIPアドレスを名乗る。
// 転送の応答はサーバーの応答をそのまま確かめられるよう追わない
export function createPublicApiClient({
  env = process.env,
  clientIp = randomDocumentationIpv6(),
  send = fetch,
}: PublicApiClientOptions = {}): PublicApiClient {
  return {
    request: async ({ apiKey, path, method = 'GET', body }) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        Accept: JSON_MEDIA_TYPE,
        [CONNECTING_IP_HEADER]: clientIp,
      };
      const init: RequestInit =
        body === undefined
          ? { method, headers, redirect: 'manual' }
          : {
              method,
              headers: { ...headers, 'Content-Type': JSON_MEDIA_TYPE },
              body: JSON.stringify(body),
              redirect: 'manual',
            };
      const response = await send(publicApiUrl(path, env), init);
      return { status: response.status, body: await bodyOf(response) };
    },
  };
}
