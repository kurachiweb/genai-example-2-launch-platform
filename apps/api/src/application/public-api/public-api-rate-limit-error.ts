import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { PublicApiRateLimitStatus } from './ports.ts';

const RATE_LIMIT_EXCEEDED_CODE = 'rate_limit_exceeded';
const RATE_LIMIT_EXCEEDED_MESSAGE =
  '操作が集中しています。しばらく待ってから再度お試しください。';

// 共通のエラー処理は回数の値を応答に載せないため、公開APIの中間処理が429にもX-RateLimit-*を付けられるよう値を例外に持たせる
export class PublicApiRateLimitError extends AppError {
  readonly rateLimit: PublicApiRateLimitStatus;

  constructor(init: {
    readonly rateLimit: PublicApiRateLimitStatus;
    readonly retryAfterSeconds: number;
  }) {
    super({
      kind: 'rate_limited',
      code: RATE_LIMIT_EXCEEDED_CODE,
      message: RATE_LIMIT_EXCEEDED_MESSAGE,
      retryAfterSeconds: init.retryAfterSeconds,
    });
    this.rateLimit = Object.freeze({
      limit: init.rateLimit.limit,
      remaining: init.rateLimit.remaining,
      resetAt: init.rateLimit.resetAt,
    });
  }
}
