import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type {
  ImageTransformer,
  ImageTransformResult,
} from '../../application/media/ports.ts';

export type ImagesInputBinding = Pick<ImagesBinding, 'input'>;

type TransformInput = Parameters<ImageTransformer['transform']>[0];

// 画像でない・画素数や処理量の上限を超える・形式を読めないなど、同じ原本で再試行しても変わらない失敗
const INVALID_IMAGE_ERROR_CODES: ReadonlySet<number> = new Set([
  9412, 9413, 9520, 9522, 9523,
]);

const logger = getAppLogger(['event', 'media', 'delivery']);

function errorCodeOf(error: unknown): number | undefined {
  if (!(error instanceof Error) || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'number' ? error.code : undefined;
}

export class ImagesBindingTransformer implements ImageTransformer {
  constructor(private readonly images: ImagesInputBinding) {}

  async transform(input: TransformInput): Promise<ImageTransformResult> {
    const { body, variant, format, quality, anim } = input;
    try {
      // JPEG出力のメタデータは指定せず変換基盤の既定に任せる。WebP・AVIF・PNG出力は常にメタデータを含まない
      const result = await this.images
        .input(body)
        .transform({
          width: variant.width,
          height: variant.height,
          fit: variant.fit,
        })
        .output({ format, quality, anim });
      return {
        ok: true,
        body: result.image(),
        contentType: result.contentType(),
      };
    } catch (error) {
      const code = errorCodeOf(error);
      if (code === undefined) {
        throw error;
      }
      if (INVALID_IMAGE_ERROR_CODES.has(code)) {
        logger.info('原本を画像として変換できませんでした', {
          errorCode: code,
          variant: variant.name,
          format,
        });
        return { ok: false, reason: 'invalid-image' };
      }
      logger.warn('画像の変換が一時的に失敗しました', {
        errorCode: code,
        variant: variant.name,
        format,
      });
      return { ok: false, reason: 'unavailable' };
    }
  }
}
