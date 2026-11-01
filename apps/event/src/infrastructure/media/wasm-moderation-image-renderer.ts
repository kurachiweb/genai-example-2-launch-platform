import { Resvg, type ResvgRenderOptions } from '@cf-wasm/resvg/workerd';
import {
  optimizeImage,
  type OptimizeParams,
  type OptimizeResult,
} from 'wasm-image-optimization/workerd';

import { DEFAULT_SVG_FONT_SIZE_PIXELS } from '../../../lib/core/media/svg-root.ts';
import {
  encodePng,
  padRgba,
  type RgbaImage,
} from '../../application/media/png-encoder.ts';
import type {
  ModerationImage,
  ModerationImagePlan,
  ModerationImageRenderer,
  ModerationImageRenderResult,
} from '../../application/media/ports.ts';
import { prepareSvgForRendering } from '../../application/media/svg-render-size.ts';
import liberationSans from './fonts/LiberationSans-Regular.ttf';

export type ImageOptimizer = (
  params: OptimizeParams,
) => Promise<OptimizeResult>;

export interface SvgRenderBox {
  readonly width: number;
  readonly height: number;
}

// 縦横比を保って箱の中に収めた、乗算済みでないRGBAの画素。SVGとして読み込めなければ未設定
export type SvgRasterizer = (
  svg: string,
  box: SvgRenderBox,
) => Promise<RgbaImage | undefined>;

type ScalingPlan = Exclude<ModerationImagePlan, { readonly kind: 'as-is' }>;

// wasm-image-optimizationは本文を画像として読み込めない場合だけこの文言のErrorを投げ、符号化やwasmの実行時の失敗と型では区別できない
const LOAD_FAILURE_MESSAGE = 'Failed to load image';

const BUNDLED_FONT_FAMILY = 'Liberation Sans';

// resvgが文書を読み込めない場合(XMLの構文・UTF-8・gzip・表示領域の大きさ・要素数の上限)のErrorの文言の先頭。wasmの実行時の失敗とは型で区別できない
const SVG_LOAD_FAILURE_PREFIXES: readonly string[] = Object.freeze([
  'SVG data parsing failed',
  'SVG has an invalid size',
  'provided data has not an UTF-8 encoding',
  'provided data has a malformed GZip content',
]);

// wasm版のresvgは書体を持たないため、ラテン文字の書体を同梱して渡す。指定の書体が無い文字列もこの書体で描かれ、書体に無い文字(日本語など)は代替の四角形で描かれ、文字の形は判定されない。
// 文字の大きさの既定はresvgの12pxではなくブラウザと同じ値にし、em・exも同じ大きさで解釈させる
const RESVG_OPTIONS: ResvgRenderOptions = Object.freeze({
  font: Object.freeze({
    fontBuffers: [new Uint8Array(liberationSans)],
    defaultFontFamily: BUNDLED_FONT_FAMILY,
    defaultFontSize: DEFAULT_SVG_FONT_SIZE_PIXELS,
  }),
});

const BYTES_PER_PIXEL = 4;
const OPAQUE = 255;

const UNDECODABLE: ModerationImageRenderResult = Object.freeze({
  ok: false,
  reason: 'undecodable',
});

const succeeded = (image: ModerationImage): ModerationImageRenderResult =>
  Object.freeze({ ok: true, image: Object.freeze(image) });

const isLoadFailure = (error: unknown): boolean =>
  error instanceof Error && error.message === LOAD_FAILURE_MESSAGE;

const isSvgLoadFailure = (error: unknown): boolean =>
  error instanceof Error &&
  SVG_LOAD_FAILURE_PREFIXES.some((prefix) => error.message.startsWith(prefix));

// resvgの画素は透明度を乗算済みのため、PNGの画素(乗算済みでない値)に戻す
function unpremultiply(pixels: Uint8Array): Uint8Array {
  const result = new Uint8Array(pixels.length);
  for (let offset = 0; offset < pixels.length; offset += BYTES_PER_PIXEL) {
    const alpha = pixels[offset + 3] ?? 0;
    result[offset + 3] = alpha;
    if (alpha === 0) {
      continue;
    }
    for (let channel = 0; channel < 3; channel += 1) {
      const value = pixels[offset + channel] ?? 0;
      result[offset + channel] =
        alpha === OPAQUE
          ? value
          : Math.min(OPAQUE, Math.round((value * OPAQUE) / alpha));
    }
  }
  return result;
}

// 描画器が拡大縮小の切り上げで箱を1px超えて描いた場合に、はみ出た行と列を落とす
function cropToBox(image: RgbaImage, box: SvgRenderBox): RgbaImage {
  if (image.width <= box.width && image.height <= box.height) {
    return image;
  }
  const width = Math.min(image.width, box.width);
  const height = Math.min(image.height, box.height);
  const pixels = new Uint8Array(width * height * BYTES_PER_PIXEL);
  for (let y = 0; y < height; y += 1) {
    const from = y * image.width * BYTES_PER_PIXEL;
    pixels.set(
      image.pixels.subarray(from, from + width * BYTES_PER_PIXEL),
      y * width * BYTES_PER_PIXEL,
    );
  }
  return { pixels, width, height };
}

async function loadResvg(
  svg: string,
  fitTo: NonNullable<ResvgRenderOptions['fitTo']>,
): Promise<Resvg | undefined> {
  try {
    return await Resvg.async(svg, { ...RESVG_OPTIONS, fitTo });
  } catch (error) {
    if (isSvgLoadFailure(error)) {
      return undefined;
    }
    throw error;
  }
}

// resvg自身が解釈した寸法・viewBoxの縦横比のまま箱に収まるよう、幅に合わせて読み込み、高さがはみ出せば高さに合わせて読み込み直す
async function loadFitted(
  svg: string,
  box: SvgRenderBox,
): Promise<Resvg | undefined> {
  const byWidth = await loadResvg(svg, { mode: 'width', value: box.width });
  if (
    byWidth === undefined ||
    byWidth.height * box.width <= box.height * byWidth.width
  ) {
    return byWidth;
  }
  byWidth.free();
  return loadResvg(svg, { mode: 'height', value: box.height });
}

// 描く画素は箱の大きさまでで、宣言の寸法が大きくても確保しない
export const rasterizeSvgWithResvg: SvgRasterizer = async (svg, box) => {
  const resvg = await loadFitted(svg, box);
  if (resvg === undefined) {
    return undefined;
  }
  try {
    const rendered = resvg.render();
    try {
      return {
        pixels: unpremultiply(rendered.pixels),
        width: rendered.width,
        height: rendered.height,
      };
    } finally {
      rendered.free();
    }
  } finally {
    resvg.free();
  }
};

export class WasmModerationImageRenderer implements ModerationImageRenderer {
  private readonly optimize: ImageOptimizer;
  private readonly rasterizeSvg: SvgRasterizer;

  constructor(
    optimize: ImageOptimizer = optimizeImage,
    rasterizeSvg: SvgRasterizer = rasterizeSvgWithResvg,
  ) {
    this.optimize = optimize;
    this.rasterizeSvg = rasterizeSvg;
  }

  async render(input: {
    readonly original: Uint8Array;
    readonly plan: ModerationImagePlan;
  }): Promise<ModerationImageRenderResult> {
    const { original, plan } = input;
    if (plan.kind === 'as-is') {
      return succeeded({ bytes: original, format: plan.format });
    }
    const svg = prepareSvgForRendering(original);
    switch (svg.kind) {
      case 'unreadable':
        return UNDECODABLE;
      case 'svg':
        return this.renderSvg(svg.text, plan);
      case 'not-svg':
        return this.renderRaster(original, plan);
    }
  }

  // 描画器の縦横比が計画と違う場合も、内容を切り取らずに計画の寸法(余白の計画はキャンバス)の中央へ置き白で埋める
  private async renderSvg(
    svg: string,
    plan: ScalingPlan,
  ): Promise<ModerationImageRenderResult> {
    const image = await this.rasterizeSvg(svg, plan);
    if (image === undefined) {
      return UNDECODABLE;
    }
    const canvas =
      plan.kind === 'pad'
        ? plan
        : { canvasWidth: plan.width, canvasHeight: plan.height };
    return succeeded({
      bytes: await encodePng(padRgba(cropToBox(image, plan), canvas)),
      format: 'png',
    });
  }

  private async renderRaster(
    original: Uint8Array,
    plan: ScalingPlan,
  ): Promise<ModerationImageRenderResult> {
    const scaled = await this.scale(original, plan);
    if (scaled === undefined) {
      return UNDECODABLE;
    }
    if (plan.kind === 'resize') {
      return succeeded({ bytes: scaled.data, format: plan.format });
    }
    const padded = padRgba(
      { pixels: scaled.data, width: scaled.width, height: scaled.height },
      plan,
    );
    return succeeded({ bytes: await encodePng(padded), format: 'png' });
  }

  // 計画の寸法は縦横比を保って丸めた値のため、fillで計画どおりの寸法にそろえる。アニメーションは最初のフレームだけを描く
  private async scale(
    original: Uint8Array,
    plan: ScalingPlan,
  ): Promise<OptimizeResult | undefined> {
    try {
      return await this.optimize({
        image: original,
        width: plan.width,
        height: plan.height,
        fit: 'fill',
        format: plan.kind === 'resize' ? plan.format : 'raw',
        animation: false,
      });
    } catch (error) {
      if (isLoadFailure(error)) {
        return undefined;
      }
      throw error;
    }
  }
}
