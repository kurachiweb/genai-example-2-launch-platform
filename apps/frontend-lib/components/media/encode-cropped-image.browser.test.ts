import { describe, expect, test } from 'vitest';

import {
  createDocumentFile,
  createImageFile,
  createOrientedJpegFile,
  createSplitImageFile,
  createSvgFile,
  decodeImage,
} from '../../test/media-files.ts';
import {
  encodeCroppedImage,
  readOrientedImageSize,
} from './encode-cropped-image.ts';

const RED_THRESHOLD = 200;

const OTHER_CHANNEL_THRESHOLD = 60;

const isRed = ([red = 0, green = 0, blue = 0]: readonly number[]): boolean =>
  red > RED_THRESHOLD &&
  green < OTHER_CHANNEL_THRESHOLD &&
  blue < OTHER_CHANNEL_THRESHOLD;

const isBlue = ([red = 0, green = 0, blue = 0]: readonly number[]): boolean =>
  blue > RED_THRESHOLD &&
  red < OTHER_CHANNEL_THRESHOLD &&
  green < OTHER_CHANNEL_THRESHOLD;

async function createTransparentPngFile(name: string): Promise<File> {
  const canvas = new OffscreenCanvas(40, 40);
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('見本の画像を描けません。');
  }
  context.fillStyle = '#0f766e';
  context.fillRect(10, 10, 20, 20);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new File([blob], name, { type: 'image/png' });
}

describe('encodeCroppedImage', () => {
  test('JPEGの原本は、最大寸法以下へ縮小したJPEGにし、ファイル名の拡張子をそろえる', async () => {
    const source = await createImageFile('photo.jpeg', 'image/jpeg', {
      width: 1200,
      height: 800,
    });

    const encoded = await encodeCroppedImage(
      source,
      { x: 0, y: 0, width: 1200, height: 800 },
      600,
    );
    const decoded = await decodeImage(encoded);

    expect(encoded.type).toBe('image/jpeg');
    expect(encoded.name).toBe('photo.jpg');
    expect({ width: decoded.width, height: decoded.height }).toStrictEqual({
      width: 600,
      height: 400,
    });
  });

  test('PNGの原本は、透明な部分を残したPNGにする', async () => {
    const source = await createTransparentPngFile('logo.png');

    const encoded = await encodeCroppedImage(
      source,
      { x: 0, y: 0, width: 40, height: 40 },
      512,
    );
    const decoded = await decodeImage(encoded);

    expect(encoded.type).toBe('image/png');
    expect(encoded.name).toBe('logo.png');
    expect(decoded.colorAt(0, 0)[3]).toBe(0);
    expect(decoded.colorAt(20, 20)[3]).toBe(255);
  });

  test('WebPの原本はPNGにし、ファイル名の拡張子をpngにする', async () => {
    const source = await createImageFile('banner.webp', 'image/webp', {
      width: 80,
      height: 40,
    });

    const encoded = await encodeCroppedImage(
      source,
      { x: 0, y: 0, width: 80, height: 40 },
      512,
    );

    expect(encoded.type).toBe('image/png');
    expect(encoded.name).toBe('banner.png');
  });

  test('拡張子の無いファイル名には、出力の形式の拡張子を付ける', async () => {
    const source = await createImageFile('photo', 'image/jpeg', {
      width: 40,
      height: 40,
    });

    const encoded = await encodeCroppedImage(
      source,
      { x: 0, y: 0, width: 40, height: 40 },
      512,
    );

    expect(encoded.name).toBe('photo.jpg');
  });

  test('指定した範囲だけを切り取る', async () => {
    const source = await createSplitImageFile('split.png', 'image/png', {
      width: 200,
      height: 100,
    });

    const left = await decodeImage(
      await encodeCroppedImage(
        source,
        { x: 0, y: 0, width: 100, height: 100 },
        512,
      ),
    );
    const right = await decodeImage(
      await encodeCroppedImage(
        source,
        { x: 100, y: 0, width: 100, height: 100 },
        512,
      ),
    );

    expect({ width: left.width, height: left.height }).toStrictEqual({
      width: 100,
      height: 100,
    });
    expect(isRed(left.colorAt(0, 0))).toBe(true);
    expect(isRed(left.colorAt(99, 99))).toBe(true);
    expect(isBlue(right.colorAt(0, 0))).toBe(true);
    expect(isBlue(right.colorAt(99, 99))).toBe(true);
  });

  test('原本の外へはみ出した端数の範囲は、原本の内側の画素に収める', async () => {
    const source = await createSplitImageFile('split.png', 'image/png', {
      width: 200,
      height: 100,
    });

    const decoded = await decodeImage(
      await encodeCroppedImage(
        source,
        { x: -0.4, y: -0.3, width: 200.9, height: 100.6 },
        512,
      ),
    );

    expect({ width: decoded.width, height: decoded.height }).toStrictEqual({
      width: 200,
      height: 100,
    });
    expect(isRed(decoded.colorAt(0, 0))).toBe(true);
    expect(isBlue(decoded.colorAt(199, 99))).toBe(true);
  });

  test('Exifの向きが付いたJPEGは、表示の向きに回した画素で切り取り、向きの情報の無い画像にする', async () => {
    const source = await createOrientedJpegFile(
      'portrait.jpg',
      { width: 80, height: 40 },
      6,
    );

    const size = await readOrientedImageSize(source);
    const encoded = await encodeCroppedImage(
      source,
      { x: 0, y: 0, width: size.width, height: size.height },
      512,
    );
    const decoded = await decodeImage(encoded);

    expect(size).toStrictEqual({ width: 40, height: 80 });
    expect({ width: decoded.width, height: decoded.height }).toStrictEqual({
      width: 40,
      height: 80,
    });
    expect(isRed(decoded.colorAt(20, 5))).toBe(true);
    expect(isBlue(decoded.colorAt(20, 74))).toBe(true);
    expect(
      new TextDecoder('latin1').decode(await encoded.arrayBuffer()),
    ).not.toContain('Exif');
  });

  test('SVGと画像でないファイルは作り直さない', async () => {
    const area = { x: 0, y: 0, width: 40, height: 40 };

    await expect(
      encodeCroppedImage(createSvgFile('logo.svg'), area, 512),
    ).rejects.toThrow(RangeError);
    await expect(
      encodeCroppedImage(
        createDocumentFile('notes.txt', 'text/plain', 8),
        area,
        512,
      ),
    ).rejects.toThrow(RangeError);
  });

  test('読み込めない画像は、作り直しも寸法の読み取りも失敗にする', async () => {
    const broken = createDocumentFile('broken.png', 'image/png', 16);

    await expect(
      encodeCroppedImage(broken, { x: 0, y: 0, width: 4, height: 4 }, 512),
    ).rejects.toThrow();
    await expect(readOrientedImageSize(broken)).rejects.toThrow();
  });
});
