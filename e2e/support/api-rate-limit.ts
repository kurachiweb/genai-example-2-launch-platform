import { resolveLocalWorkerOrigin } from './local-worker-origins.ts';

export type SendRequest = (url: URL, init: RequestInit) => Promise<Response>;

// apps/backend-libのworkers/http/health-route.tsのHEALTH_CHECK_PATHの写し。一致はルートのconfig/contract-copies.unit.test.tsが確かめる。経路はIPアドレス単位の制限の後に登録されるため、要求が制限の回数に数えられる
const HEALTH_CHECK_PATH = '/health';

const CONNECTING_IP_HEADER = 'CF-Connecting-IP';

const RATE_LIMITED_STATUS = 429;

const BATCH_SIZE = 20;

const MAX_REQUESTS = 1_000;

const statusOf = async (
  send: SendRequest,
  url: URL,
  clientIp: string,
): Promise<number> => {
  const response = await send(url, {
    headers: { [CONNECTING_IP_HEADER]: clientIp },
  });
  await response.body?.cancel();
  return response.status;
};

// APIサーバーのIPアドレス単位の制限はフロントエンドサーバーの同じ制限と別に数えるため、APIサーバーへ直接要求してそのIPアドレスの残りの回数を使い切る。
// 同じIPアドレスを名乗るページの要求は、フロントエンドサーバーの制限に掛からずに、サーバー側の描画でのAPIサーバーからの取得だけが失敗する。
// ローカルのWorkerは直接の要求の接続元をこのヘッダーから読み、制限の期間が過ぎると回数が戻るため、使い切った直後に使う
export async function exhaustApiIpRateLimit(
  clientIp: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  send: SendRequest = fetch,
): Promise<void> {
  const url = new URL(HEALTH_CHECK_PATH, resolveLocalWorkerOrigin('api', env));
  for (let sent = 0; sent < MAX_REQUESTS; sent += BATCH_SIZE) {
    const statuses = await Promise.all(
      Array.from({ length: BATCH_SIZE }, () => statusOf(send, url, clientIp)),
    );
    if (statuses.includes(RATE_LIMITED_STATUS)) {
      return;
    }
  }
  throw new Error(
    `APIサーバーのIPアドレス単位の制限に${String(MAX_REQUESTS)}回の要求で達しませんでした: ${url.href}`,
  );
}
