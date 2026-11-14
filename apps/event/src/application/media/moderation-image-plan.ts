import type { ImageMediaType } from '../../../common-lib/media/media-types.ts';
import type { ModerationImageFormat, ModerationImagePlan } from './ports.ts';

// maxBytesは判定サービス(Rekognition)のImage.Bytesの最大長、minSideは判定サービスが受け付ける各辺の下限
export const MODERATION_IMAGE_LIMITS = Object.freeze({
  maxLongSide: 640,
  minSide: 80,
  maxBytes: 5_242_880,
} as const);

export interface ModerationImagePlanInput {
  readonly type: ImageMediaType;
  readonly width: number;
  readonly height: number;
  readonly byteSize: number;
}

const DIRECT_FORMAT_BY_TYPE: Readonly<
  Partial<Record<ImageMediaType, ModerationImageFormat>>
> = Object.freeze({ 'image/jpeg': 'jpeg', 'image/png': 'png' });

const assertPositiveInteger = (name: string, value: number): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(
      `${name}は正の整数で指定してください: ${String(value)}`,
    );
  }
};

const assertInput = (input: ModerationImagePlanInput): void => {
  assertPositiveInteger('width', input.width);
  assertPositiveInteger('height', input.height);
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 0) {
    throw new RangeError(
      `byteSizeは0以上の整数で指定してください: ${String(input.byteSize)}`,
    );
  }
};

// 極端な縦横比でも短辺が0pxにならないよう、縮小後の各辺を1px以上に保つ
const scaledSide = (side: number, scale: number): number =>
  Math.max(1, Math.round(side * scale));

const fitsAsIs = (input: ModerationImagePlanInput): boolean =>
  Math.max(input.width, input.height) <= MODERATION_IMAGE_LIMITS.maxLongSide &&
  Math.min(input.width, input.height) >= MODERATION_IMAGE_LIMITS.minSide &&
  input.byteSize <= MODERATION_IMAGE_LIMITS.maxBytes;

export function planModerationImage(
  input: ModerationImagePlanInput,
): ModerationImagePlan {
  assertInput(input);
  const directFormat = DIRECT_FORMAT_BY_TYPE[input.type];
  if (directFormat !== undefined && fitsAsIs(input)) {
    return Object.freeze({ kind: 'as-is', format: directFormat });
  }
  const scale = Math.min(
    1,
    MODERATION_IMAGE_LIMITS.maxLongSide / Math.max(input.width, input.height),
  );
  const width = scaledSide(input.width, scale);
  const height = scaledSide(input.height, scale);
  if (Math.min(width, height) >= MODERATION_IMAGE_LIMITS.minSide) {
    return Object.freeze({
      kind: 'resize',
      width,
      height,
      format: input.type === 'image/jpeg' ? 'jpeg' : 'png',
    });
  }
  return Object.freeze({
    kind: 'pad',
    width,
    height,
    canvasWidth: Math.max(width, MODERATION_IMAGE_LIMITS.minSide),
    canvasHeight: Math.max(height, MODERATION_IMAGE_LIMITS.minSide),
  });
}
