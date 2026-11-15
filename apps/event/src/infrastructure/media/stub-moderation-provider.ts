import type { ImageMediaType } from '../../../common-lib/media/media-types.ts';
import { readImageDimensions } from '../../../lib/core/media/image-dimensions.ts';
import type {
  ModerationImage,
  ModerationImageFormat,
  ModerationOutcome,
  ModerationProvider,
} from '../../application/media/ports.ts';
import { decideStubModeration } from '../../application/media/stub-moderation-rules.ts';

const MEDIA_TYPE_BY_FORMAT: Readonly<
  Record<ModerationImageFormat, ImageMediaType>
> = Object.freeze({
  png: 'image/png',
  jpeg: 'image/jpeg',
});

export class StubModerationProvider implements ModerationProvider {
  detect(image: ModerationImage): Promise<ModerationOutcome> {
    const size = readImageDimensions(
      image.bytes,
      MEDIA_TYPE_BY_FORMAT[image.format],
    );
    // 判定サービスも寸法を読めない画像を受け付けないため、同じ結果にして隔離の経路を再現する
    if (size === undefined) {
      return Promise.resolve({ kind: 'rejected', reason: 'invalid-image' });
    }
    return Promise.resolve(decideStubModeration(size));
  }
}
