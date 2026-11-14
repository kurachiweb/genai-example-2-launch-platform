export const WEB_ANALYTICS_BEACON_SRC =
  'https://static.cloudflareinsights.com/beacon.min.js';

export interface WebAnalyticsHeadScript {
  readonly src: string;
  readonly defer: true;
  readonly 'data-cf-beacon': string;
}

// 計測スクリプトはdeferで最初の描画を妨げず、読み込みや送信の失敗はスクリプトの中で閉じて画面へ伝わらない。nonceはルーターがheadのスクリプトに付ける
export const webAnalyticsHeadScript = (
  token: string | undefined,
): WebAnalyticsHeadScript | undefined => {
  if (token === undefined || token === '') {
    return undefined;
  }
  return Object.freeze({
    src: WEB_ANALYTICS_BEACON_SRC,
    defer: true,
    'data-cf-beacon': JSON.stringify({ token }),
  });
};
