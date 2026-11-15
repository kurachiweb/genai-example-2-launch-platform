import { expect } from 'vitest';
import { optimizeImage } from 'wasm-image-optimization/workerd';

import type { ImageMediaType } from '../../../common-lib/media/media-types.ts';
import { readImageDimensions } from '../../../lib/core/media/image-dimensions.ts';
import { planModerationImage } from '../../application/media/moderation-image-plan.ts';
import { encodePng } from '../../application/media/png-encoder.ts';
import type {
  ModerationImage,
  ModerationImagePlan,
  ModerationImageRenderer,
} from '../../application/media/ports.ts';
import { WasmModerationImageRenderer } from './wasm-moderation-image-renderer.ts';

export type Rgba = readonly [number, number, number, number];

export const RED: Rgba = [255, 0, 0, 255];
export const LIME: Rgba = [0, 255, 0, 255];
export const BLUE: Rgba = [0, 0, 255, 255];
export const BLACK: Rgba = [0, 0, 0, 255];
export const WHITE: Rgba = [255, 255, 255, 255];

// JPEGの非可逆圧縮と縮小の補間で色の境目以外の画素がずれる幅
const LOSSY_TOLERANCE = 24;

// 判定の処理が寸法の無いSVGに渡す寸法
const UNKNOWN_SVG_SIDE = 640;

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

function rgbaOf(
  width: number,
  height: number,
  colorAt: (x: number, y: number) => Rgba,
): DecodedImage {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels.set(colorAt(x, y), (y * width + x) * 4);
    }
  }
  return { pixels, width, height };
}

export const pngOf = (
  width: number,
  height: number,
  colorAt: (x: number, y: number) => Rgba,
): Promise<Uint8Array> => encodePng(rgbaOf(width, height, colorAt));

export async function convert(
  png: Uint8Array,
  format: 'jpeg' | 'webp',
): Promise<Uint8Array> {
  return (await optimizeImage({ image: png, format })).data;
}

export const encode = (text: string): Uint8Array =>
  new TextEncoder().encode(text);

export const svgOf = (
  width: number,
  height: number,
  fill: string,
): Uint8Array =>
  encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}"><rect width="${String(width)}" height="${String(height)}" fill="${fill}"/></svg>`,
  );

export function planFor(
  type: ImageMediaType,
  width: number,
  height: number,
  original: Uint8Array,
): ModerationImagePlan {
  return planModerationImage({
    type,
    width,
    height,
    byteSize: original.byteLength,
  });
}

// 受付と同じく画像の寸法の読み取りで得た寸法(読めなければ判定の処理と同じ寸法)から計画を作る
export function svgPlanFor(original: Uint8Array): ModerationImagePlan {
  const size = readImageDimensions(original, 'image/svg+xml');
  return planFor(
    'image/svg+xml',
    size?.width ?? UNKNOWN_SVG_SIDE,
    size?.height ?? UNKNOWN_SVG_SIDE,
    original,
  );
}

export async function decode(bytes: Uint8Array): Promise<DecodedImage> {
  const result = await optimizeImage({ image: bytes, format: 'raw' });
  return { pixels: result.data, width: result.width, height: result.height };
}

export function pixelAt(image: DecodedImage, x: number, y: number): Rgba {
  const offset = (y * image.width + x) * 4;
  const [red = 0, green = 0, blue = 0, alpha = 0] = image.pixels.subarray(
    offset,
    offset + 4,
  );
  return [red, green, blue, alpha];
}

export function expectNear(actual: Rgba, expected: Rgba): void {
  actual.forEach((channel, index) => {
    expect(Math.abs(channel - (expected[index] ?? 0))).toBeLessThanOrEqual(
      LOSSY_TOLERANCE,
    );
  });
}

// 判定の処理と同じくポートの型で呼ぶ
export const renderer = (): ModerationImageRenderer =>
  new WasmModerationImageRenderer();

export async function renderOk(
  original: Uint8Array,
  plan: ModerationImagePlan,
): Promise<ModerationImage> {
  const result = await renderer().render({ original, plan });
  if (!result.ok) {
    throw new Error(`描画に失敗しました: ${result.reason}`);
  }
  return result.image;
}

// 座標0〜sideの正方形を赤で塗り、右下の4分の1だけを緑で塗る
export const quarteredContent = (side: number): string =>
  `<rect width="${String(side)}" height="${String(side)}" fill="red"/><rect x="${String(side / 2)}" y="${String(side / 2)}" width="${String(side / 2)}" height="${String(side / 2)}" fill="lime"/>`;

export function expectQuarteredContent(image: DecodedImage): void {
  const at = (ratio: number, side: number): number => Math.floor(side * ratio);
  expect(
    pixelAt(image, at(0.25, image.width), at(0.25, image.height)),
  ).toStrictEqual(RED);
  expect(
    pixelAt(image, at(0.75, image.width), at(0.75, image.height)),
  ).toStrictEqual(LIME);
}
