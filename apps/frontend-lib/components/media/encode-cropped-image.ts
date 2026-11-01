import {
  isImageMediaType,
  parseMediaType,
  type RasterImageMediaType,
} from '../../../common-lib/media/media-types.ts';
import {
  type CropArea,
  type CropOutput,
  computeCropOutput,
} from '../../utilities/media/crop-geometry.ts';

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

const JPEG_QUALITY = 0.9;

const OUTPUT_EXTENSIONS: Readonly<Record<CropOutput['type'], string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

const rasterTypeOf = (file: Blob): RasterImageMediaType => {
  const type = parseMediaType(file.type);
  if (
    type === undefined ||
    !isImageMediaType(type) ||
    type === 'image/svg+xml'
  ) {
    throw new RangeError('作り直せるのはSVG以外の画像だけです。');
  }
  return type;
};

// 編集の画面の<img>はExifの向きを反映して表示するため、切り取る範囲の座標と合うよう向きを反映した画素で読む
const decodeOriented = (file: Blob): Promise<ImageBitmap> =>
  createImageBitmap(file, { imageOrientation: 'from-image' });

export async function readOrientedImageSize(file: Blob): Promise<ImageSize> {
  const bitmap = await decodeOriented(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

const clampedArea = (area: CropArea, bounds: ImageSize): CropArea => {
  const left = Math.min(bounds.width - 1, Math.max(0, Math.round(area.x)));
  const top = Math.min(bounds.height - 1, Math.max(0, Math.round(area.y)));
  const right = Math.min(
    bounds.width,
    Math.max(left + 1, Math.round(area.x + area.width)),
  );
  const bottom = Math.min(
    bounds.height,
    Math.max(top + 1, Math.round(area.y + area.height)),
  );
  return { x: left, y: top, width: right - left, height: bottom - top };
};

const renamed = (name: string, type: CropOutput['type']): string => {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.${OUTPUT_EXTENSIONS[type]}`;
};

const canvasToBlob = (
  canvas: HTMLCanvasElement,
  type: CropOutput['type'],
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          reject(new Error('切り取った画像を作れませんでした。'));
          return;
        }
        resolve(blob);
      },
      type,
      type === 'image/jpeg' ? JPEG_QUALITY : undefined,
    );
  });

export async function encodeCroppedImage(
  file: File,
  area: CropArea,
  maxLongSide: number,
): Promise<File> {
  const sourceType = rasterTypeOf(file);
  const bitmap = await decodeOriented(file);
  try {
    const source = clampedArea(area, bitmap);
    const output = computeCropOutput({ area: source, maxLongSide, sourceType });
    const canvas = document.createElement('canvas');
    canvas.width = output.width;
    canvas.height = output.height;
    const context = canvas.getContext('2d');
    if (context === null) {
      throw new Error('切り取った画像を描けません。');
    }
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      bitmap,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      output.width,
      output.height,
    );
    const blob = await canvasToBlob(canvas, output.type);
    return new File([blob], renamed(file.name, output.type), {
      type: output.type,
      lastModified: Date.now(),
    });
  } finally {
    bitmap.close();
  }
}
