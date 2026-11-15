import type {
  MediaFileView,
  MediaLocation,
} from '../../core/media/media-file.ts';
import {
  MEDIA_MESSAGE_LIMITS,
  PURGE_IMAGE_CACHE_MESSAGE,
} from '../../core/media/media-messages.ts';
import type {
  EraseSummary,
  MediaEraser,
  MediaFileStore,
  MediaObjectStore,
} from '../../core/media/ports.ts';
import type { MessagePublisher } from '../messaging/queue-publisher.ts';

export interface MediaFileEraserDependencies {
  readonly files: MediaFileStore;
  readonly objects: MediaObjectStore;
  readonly publisher: MessagePublisher;
}

const LOCATIONS: readonly MediaLocation[] = Object.freeze([
  'images',
  'quarantine',
  'files',
]);

// 画像は隔離・復元の移動の途中で両方のバケットに置かれ得るため、記録の保存先によらず両方から消す
const ERASE_LOCATIONS_BY_STORAGE: Readonly<
  Record<MediaFileView['storage'], readonly MediaLocation[]>
> = Object.freeze({
  images: Object.freeze(['images', 'quarantine'] as const),
  files: Object.freeze(['files'] as const),
});

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

// 記録を最後に消すため、どの段階で失敗しても記録が残り、同じ要求の再実行(日次の削除を含む)が残りの段階をやり直せる
export class MediaFileEraser implements MediaEraser {
  private readonly files: MediaFileStore;
  private readonly objects: MediaObjectStore;
  private readonly publisher: MessagePublisher;

  constructor(dependencies: MediaFileEraserDependencies) {
    this.files = dependencies.files;
    this.objects = dependencies.objects;
    this.publisher = dependencies.publisher;
  }

  async erase(fileIds: readonly string[]): Promise<EraseSummary> {
    const targets = [...(await this.files.findViews(fileIds)).values()];
    if (targets.length === 0) {
      return { erased: 0 };
    }
    for (const location of LOCATIONS) {
      const keys = targets
        .filter((target) =>
          ERASE_LOCATIONS_BY_STORAGE[target.storage].includes(location),
        )
        .map((target) => target.objectKey);
      if (keys.length > 0) {
        await this.objects.delete(location, keys);
      }
    }
    // パージはバケットから消した後に依頼し、配信がキャッシュの無効化の後に古い画像を取り直さないようにする
    const imageKeys = targets
      .filter((target) => target.storage === 'images')
      .map((target) => target.objectKey);
    for (const objectKeys of chunk(
      imageKeys,
      MEDIA_MESSAGE_LIMITS.purgeBatch,
    )) {
      await this.publisher.publish(PURGE_IMAGE_CACHE_MESSAGE, { objectKeys });
    }
    await this.files.remove(targets.map((target) => target.id));
    return { erased: targets.length };
  }
}
