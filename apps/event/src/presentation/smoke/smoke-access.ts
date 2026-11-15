import { AppError } from '../../../lib/core/errors/app-error.ts';
import { NOT_FOUND_RESPONSE } from '../../../lib/core/errors/error-envelope.ts';

const BEARER_CREDENTIALS_PATTERN = /^Bearer (.+)$/iu;

const textEncoder = new TextEncoder();

// 経路の存在を明かさないよう、未登録の経路と同じ定型の404にする
export function createSmokeNotFoundError(): AppError {
  return new AppError({
    kind: 'not_found',
    code: NOT_FOUND_RESPONSE.body.error.code,
    message: NOT_FOUND_RESPONSE.body.error.message,
  });
}

export function createSmokeUnauthenticatedError(): AppError {
  return new AppError({
    kind: 'unauthenticated',
    code: 'unauthenticated',
    message: '認証されていません。',
  });
}

function sha256(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', textEncoder.encode(value));
}

// 比べる時間から正しいトークンの長さや一致した位置を推測させないよう、同じ長さのハッシュ値どうしを時間一定で比べる
export async function matchesSmokeToken(
  authorization: string | undefined,
  token: string,
): Promise<boolean> {
  const presented = BEARER_CREDENTIALS_PATTERN.exec(authorization ?? '')?.[1];
  if (presented === undefined) {
    return false;
  }
  const [presentedHash, tokenHash] = await Promise.all([
    sha256(presented),
    sha256(token),
  ]);
  return crypto.subtle.timingSafeEqual(presentedHash, tokenHash);
}
