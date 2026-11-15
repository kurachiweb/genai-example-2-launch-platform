import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { InvocationScope } from '../../../lib/workers/di/invocation-container.ts';
import type { PlatformEnv } from '../../../lib/workers/env/platform-env.ts';
import type {
  ImageCachePurger,
  ImageCachePurgeResult,
} from '../../application/media/ports.ts';

// パージは呼び出したエントリポイントのキャッシュにだけ効くため、画像配信のエントリポイント自身のメソッドで行わせる。独自のメソッドの呼び出しはキャッシュを通らない
@injectable()
export class WorkersCachePurger implements ImageCachePurger {
  constructor(
    @inject(PLATFORM_TYPES.InvocationScope)
    private readonly scope: InvocationScope<PlatformEnv>,
  ) {}

  async purge(objectKeys: readonly string[]): Promise<ImageCachePurgeResult> {
    const result =
      await this.scope.executionCtx.exports.ImageDelivery.purgeObjectKeys(
        objectKeys,
      );
    return result.ok
      ? { ok: true }
      : { ok: false, errorCodes: [...result.errorCodes] };
  }
}
