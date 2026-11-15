export const LIVE_REFRESH_INTERVAL_MS = 30_000;

export interface LiveRefreshQueryOptions {
  readonly refetchInterval: typeof LIVE_REFRESH_INTERVAL_MS;
  readonly refetchIntervalInBackground: false;
  readonly refetchOnWindowFocus: true;
  readonly staleTime: 0;
}

// アプリの既定の鮮度(30秒)とフォーカスで取り直さない設定を、表示中の画面の取得だけで上書きする。非表示のタブでは止めて要求を減らし、戻った時に取り直して最新を示す
export const LIVE_REFRESH_QUERY_OPTIONS: LiveRefreshQueryOptions =
  Object.freeze({
    refetchInterval: LIVE_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
