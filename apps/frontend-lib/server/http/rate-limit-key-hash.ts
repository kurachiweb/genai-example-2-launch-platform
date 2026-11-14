// 共通部品はbackend-libを読み込めないため、apps/backend-libのcore/rate-limit/rate-limit-key.ts(core/crypto/keyed-hasher.ts)と同じ値を作る計算を写して持つ。同じ値になることはルートのconfig/contract-copies.unit.test.tsが両方を実行して確かめる
export const RATE_LIMIT_KEY_PURPOSE = 'rate-limit-key';

const PURPOSE_SEPARATOR = '\u0000';
const BASE64URL_OPTIONS = {
  alphabet: 'base64url',
  omitPadding: true,
} as const;

const textEncoder = new TextEncoder();

export async function hashRateLimitKey(
  pepper: string,
  ...parts: readonly string[]
): Promise<string> {
  if (parts.length === 0) {
    throw new RangeError('レート制限のキーには1つ以上の部品が必要です。');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(pepper),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  );
  // 部品の境界を残して連結し、("ab","c")と("a","bc")のような組み合わせが同じキーにならないようにする
  const message = `${RATE_LIMIT_KEY_PURPOSE}${PURPOSE_SEPARATOR}${JSON.stringify(parts)}`;
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    textEncoder.encode(message),
  );
  return new Uint8Array(signature).toBase64(BASE64URL_OPTIONS);
}
