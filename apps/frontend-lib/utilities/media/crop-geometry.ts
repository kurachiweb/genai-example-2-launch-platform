import type { RasterImageMediaType } from '../../../common-lib/media/media-types.ts';

export interface CropOutputInput {
  readonly area: { readonly width: number; readonly height: number };
  readonly maxLongSide: number;
  readonly sourceType: RasterImageMediaType;
}

export interface CropOutput {
  readonly width: number;
  readonly height: number;
  readonly type: 'image/jpeg' | 'image/png';
}

const isPositiveFinite = (value: number): boolean =>
  Number.isFinite(value) && value > 0;

const scaledSide = (side: number, scale: number, maxLongSide: number): number =>
  Math.min(maxLongSide, Math.max(1, Math.round(side * scale)));

export const computeCropOutput = (input: CropOutputInput): CropOutput => {
  const { area, maxLongSide } = input;
  if (
    !isPositiveFinite(area.width) ||
    !isPositiveFinite(area.height) ||
    !Number.isSafeInteger(maxLongSide) ||
    maxLongSide <= 0
  ) {
    throw new RangeError(
      '切り取る範囲は正の値、最大寸法は正の整数で指定してください。',
    );
  }
  const scale = Math.min(1, maxLongSide / Math.max(area.width, area.height));
  return {
    width: scaledSide(area.width, scale, maxLongSide),
    height: scaledSide(area.height, scale, maxLongSide),
    type: input.sourceType === 'image/jpeg' ? 'image/jpeg' : 'image/png',
  };
};
