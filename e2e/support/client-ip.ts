import { randomBytes } from 'node:crypto';

import type { BrowserContext } from '@playwright/test';

const CONNECTING_IP_HEADER = 'CF-Connecting-IP';

// 文書用に予約されたIPv6のアドレス範囲(2001:db8::/32)から、実行をまたいでも衝突しない長さの乱数で選ぶ
const randomDocumentationIpv6 = (): string => {
  const groups = randomBytes(12).toString('hex').match(/.{4}/gu)?.join(':');
  return `2001:db8:${groups ?? '0'}`;
};

// IPアドレス単位の制限(メールの送信回数・ログイン試行など)の記録はローカルの状態として実行をまたいで残るため、同じ接続元から何度実行しても上限に達しないよう、ブラウザの文脈ごとに別の接続元のIPアドレスを名乗る。
// ローカルの開発サーバーとプレビューはこのヘッダーが無いときだけ接続元のアドレスを入れ、デプロイ先ではCloudflareが接続元の値で上書きする。
// 別のオリジン(bot判定のスクリプトなど)への要求に付けると事前の確認で拒否されるため、対象のオリジンへの要求にだけ付ける
export async function assumeDistinctClientIp(
  context: BrowserContext,
  baseURL: string | undefined,
): Promise<string> {
  if (!baseURL) {
    throw new Error('E2E対象のURLが設定されていません');
  }
  const targetOrigin = new URL(baseURL).origin;
  const clientIp = randomDocumentationIpv6();
  await context.route(
    (url) => url.origin === targetOrigin,
    async (route) => {
      await route.continue({
        headers: {
          ...route.request().headers(),
          [CONNECTING_IP_HEADER]: clientIp,
        },
      });
    },
  );
  return clientIp;
}
