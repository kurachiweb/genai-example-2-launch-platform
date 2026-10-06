export interface ReachabilityOptions {
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

// 状態コードに関係なくHTTPの応答があれば到達できたとみなし、リダイレクト先の不達を対象の不達と取り違えないよう辿らない
export async function assertE2ETargetReachable(
  baseURL: string | undefined,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: ReachabilityOptions = {},
): Promise<void> {
  if (!baseURL) {
    throw new Error('E2E対象のURLが設定されていません');
  }
  let response: Response;
  try {
    response = await fetch(baseURL, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`E2E対象に到達できません: ${baseURL}`, { cause: error });
  }
  await response.body?.cancel();
}
