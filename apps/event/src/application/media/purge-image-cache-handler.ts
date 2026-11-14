import { inject, injectable } from 'inversify';

import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { PurgeImageCacheBody } from '../../../lib/core/media/media-messages.ts';
import type {
  MessageHandler,
  MessageHandlingResult,
} from '../../../lib/core/messaging/message-contract.ts';
import type { RetryPolicy } from '../../../lib/core/messaging/retry-policy.ts';
import { EVENT_MEDIA_TYPES, type ImageCachePurger } from './ports.ts';

// パージの回数の上限が解けるまで待てるよう、既定より長い間隔(60・120・240・480秒)で再試行し、上限に達すればデッドレターの通知で運用者へ知らせる
export const PURGE_IMAGE_CACHE_RETRY_POLICY = Object.freeze({
  maxAttempts: 5,
  baseDelaySeconds: 60,
  maxDelaySeconds: 3600,
} as const) satisfies RetryPolicy;

export class ImageCachePurgeError extends Error {
  override readonly name = 'ImageCachePurgeError';
  readonly errorCodes: readonly number[];

  constructor(errorCodes: readonly number[]) {
    super(
      `エッジキャッシュのパージが拒否されたため再試行します: ${errorCodes.join(',')}`,
    );
    this.errorCodes = errorCodes;
  }
}

const logger = getAppLogger(['event', 'media', 'purge']);

@injectable()
export class PurgeImageCacheHandler implements MessageHandler<PurgeImageCacheBody> {
  constructor(
    @inject(EVENT_MEDIA_TYPES.ImageCachePurger)
    private readonly purger: ImageCachePurger,
  ) {}

  async handle(body: PurgeImageCacheBody): Promise<MessageHandlingResult> {
    const result = await this.purger.purge(body.objectKeys);
    if (!result.ok) {
      throw new ImageCachePurgeError(result.errorCodes);
    }
    logger.info('エッジキャッシュをパージしました', {
      purgedCount: body.objectKeys.length,
    });
    return { kind: 'done' };
  }
}
