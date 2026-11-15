import { WorkerEntrypoint } from 'cloudflare:workers';

import { OBJECT_KEY_PATTERN } from '../../../common-lib/media/image-variants.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { LogLevel } from '../../../lib/core/logging/log-level.ts';
import { MEDIA_MESSAGE_LIMITS } from '../../../lib/core/media/media-messages.ts';
import { ensureLoggingConfigured } from '../../../lib/workers/logging/configure-logging.ts';
import {
  deliverImage,
  type ImageDeliveryDeps,
} from '../../application/media/image-delivery.ts';

export interface ImageDeliveryEntrypointEnv {
  readonly LOG_LEVEL: LogLevel;
}

export interface PurgeObjectKeysResult {
  readonly ok: boolean;
  readonly skipped: boolean;
  readonly errorCodes: readonly number[];
}

export interface ImageDeliveryEntrypoint<E> extends WorkerEntrypoint<E> {
  fetch(request: Request): Promise<Response>;
  purgeObjectKeys(
    objectKeys: readonly string[],
  ): Promise<PurgeObjectKeysResult>;
}

export type ImageDeliveryEntrypointClass<E> = new (
  ctx: ExecutionContext,
  env: E,
) => ImageDeliveryEntrypoint<E>;

const logger = getAppLogger(['event', 'media', 'delivery']);

function assertPurgeTargets(objectKeys: readonly string[]): void {
  if (
    objectKeys.length === 0 ||
    objectKeys.length > MEDIA_MESSAGE_LIMITS.purgeBatch
  ) {
    throw new RangeError(
      `パージのオブジェクトキーは1件以上${String(MEDIA_MESSAGE_LIMITS.purgeBatch)}件以下で指定してください: ${String(objectKeys.length)}件`,
    );
  }
  if (!objectKeys.every((key) => OBJECT_KEY_PATTERN.test(key))) {
    throw new RangeError('オブジェクトキーの形式に合わない値は指定できません');
  }
}

export function createImageDeliveryEntrypointClass<
  E extends ImageDeliveryEntrypointEnv,
>(createDeps: (env: E) => ImageDeliveryDeps): ImageDeliveryEntrypointClass<E> {
  // 呼び出し元のWorkerから公開メソッドをRPCとして呼べるため、配信とパージ以外のメソッドを定義しない
  return class extends WorkerEntrypoint<E> {
    override async fetch(request: Request): Promise<Response> {
      ensureLoggingConfigured({ appName: 'event', level: this.env.LOG_LEVEL });
      try {
        return await deliverImage(request, createDeps(this.env));
      } catch (error) {
        logger.error('画像の配信で想定外の例外が発生しました', {
          error,
          method: request.method,
        });
        throw error;
      }
    }

    async purgeObjectKeys(
      objectKeys: readonly string[],
    ): Promise<PurgeObjectKeysResult> {
      assertPurgeTargets(objectKeys);
      // ローカルとテストの実行環境はWorkers Cacheを持たず、保存されたキャッシュも無いため省略を成功とする
      const cache = this.ctx.cache;
      if (cache === undefined) {
        return { ok: true, skipped: true, errorCodes: [] };
      }
      const result = await cache.purge({
        pathPrefixes: objectKeys.map((key) => `/${key}/`),
      });
      return {
        ok: result.success,
        skipped: false,
        errorCodes: result.errors.map((error) => error.code),
      };
    }
  };
}
