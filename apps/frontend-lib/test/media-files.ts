export type EncodableImageType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ImageFileOptions {
  readonly width: number;
  readonly height: number;
}

const SAMPLE_GRADIENT_STOPS = ['#0f766e', '#f59e0b'] as const;

export async function createImageFile(
  name: string,
  type: EncodableImageType,
  { width, height }: ImageFileOptions,
): Promise<File> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('見本の画像を描けません。');
  }
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, SAMPLE_GRADIENT_STOPS[0]);
  gradient.addColorStop(1, SAMPLE_GRADIENT_STOPS[1]);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  const blob = await canvas.convertToBlob({ type });
  return new File([blob], name, { type });
}

const SPLIT_LEFT_COLOR = '#ff0000';

const SPLIT_RIGHT_COLOR = '#0000ff';

// 切り取った範囲と向きを色で確かめられるよう、左半分を赤、右半分を青で塗った画像を作る
export async function createSplitImageFile(
  name: string,
  type: EncodableImageType,
  { width, height }: ImageFileOptions,
): Promise<File> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('見本の画像を描けません。');
  }
  const half = Math.floor(width / 2);
  context.fillStyle = SPLIT_LEFT_COLOR;
  context.fillRect(0, 0, half, height);
  context.fillStyle = SPLIT_RIGHT_COLOR;
  context.fillRect(half, 0, width - half, height);
  const blob = await canvas.convertToBlob({ type });
  return new File([blob], name, { type });
}

const JPEG_START_OF_IMAGE_LENGTH = 2;

// Exifの向き(0x0112)だけを持つAPP1の区画。TIFFの見出しはビッグエンディアン、IFDは1項目
const exifOrientationSegment = (orientation: number): Uint8Array<ArrayBuffer> =>
  Uint8Array.of(
    0xff,
    0xe1,
    0x00,
    0x22,
    ...new TextEncoder().encode('Exif'),
    0x00,
    0x00,
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08,
    0x00,
    0x01,
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    orientation,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
  );

// 保存した画素の向きと表示の向きが違うJPEG(スマートフォンで縦に構えて撮った写真など)を、左右で色の違う画像にExifの向きを付けて作る
export async function createOrientedJpegFile(
  name: string,
  stored: ImageFileOptions,
  orientation: number,
): Promise<File> {
  const jpeg = new Uint8Array(
    await (
      await createSplitImageFile(name, 'image/jpeg', stored)
    ).arrayBuffer(),
  );
  return new File(
    [
      jpeg.slice(0, JPEG_START_OF_IMAGE_LENGTH),
      exifOrientationSegment(orientation),
      jpeg.slice(JPEG_START_OF_IMAGE_LENGTH),
    ],
    name,
    { type: 'image/jpeg' },
  );
}

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly colorAt: (x: number, y: number) => readonly number[];
}

export async function decodeImage(blob: Blob): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('画像を読めません。');
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { width, height } = canvas;
  const { data } = context.getImageData(0, 0, width, height);
  return {
    width,
    height,
    colorAt: (x, y) => {
      const offset = (y * width + x) * 4;
      return Array.from(data.subarray(offset, offset + 4));
    },
  };
}

export function createSvgFile(name: string): File {
  return new File(
    [
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" fill="#0f766e"/><circle cx="20" cy="20" r="12" fill="#f59e0b"/></svg>',
    ],
    name,
    { type: 'image/svg+xml' },
  );
}

export function createDocumentFile(
  name: string,
  type: string,
  bytes: number,
): File {
  return new File([new Uint8Array(bytes)], name, { type });
}
