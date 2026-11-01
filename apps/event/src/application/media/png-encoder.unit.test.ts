import { describe, expect, test } from 'bun:test';

import { detectSignature } from '../../../lib/core/media/file-signature.ts';
import { readImageDimensions } from '../../../lib/core/media/image-dimensions.ts';
import { encodePng, padRgba, type RgbaImage } from './png-encoder.ts';

interface PngChunk {
  readonly type: string;
  readonly data: Uint8Array;
  readonly crc: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WHITE = [255, 255, 255, 255] as const;
const RED = [255, 0, 0, 255] as const;
const BLUE = [0, 0, 255, 128] as const;

const rgbaOf = (
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly number[],
): RgbaImage => {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels.set(pixel(x, y), (y * width + x) * 4);
    }
  }
  return { pixels, width, height };
};

const pixelAt = (image: RgbaImage, x: number, y: number): number[] =>
  Array.from(
    image.pixels.subarray(
      (y * image.width + x) * 4,
      (y * image.width + x + 1) * 4,
    ),
  );

const readChunks = (png: Uint8Array): PngChunk[] => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: PngChunk[] = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
    const data = png.subarray(offset + 8, offset + 8 + length);
    const crc = view.getUint32(offset + 8 + length);
    chunks.push({ type, data, crc });
    offset += 12 + length;
  }
  return chunks;
};

const chunkNamed = (png: Uint8Array, type: string): PngChunk => {
  const chunk = readChunks(png).find((candidate) => candidate.type === type);
  if (chunk === undefined) {
    throw new Error(`${type}の塊がありません。`);
  }
  return chunk;
};

const crcOf = (chunk: PngChunk): number => {
  const typeAndData = new Uint8Array(4 + chunk.data.length);
  typeAndData.set(new TextEncoder().encode(chunk.type));
  typeAndData.set(chunk.data, 4);
  return Bun.hash.crc32(typeAndData);
};

const inflate = async (data: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(
    await new Response(
      new Blob([Uint8Array.from(data)])
        .stream()
        .pipeThrough(new DecompressionStream('deflate')),
    ).arrayBuffer(),
  );

const decodeScanlines = (
  raw: Uint8Array,
  width: number,
  height: number,
): RgbaImage => {
  const stride = width * 4;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    expect(raw[y * (stride + 1)]).toBe(0);
    pixels.set(
      raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
      y * stride,
    );
  }
  return { pixels, width, height };
};

describe('encodePng', () => {
  const image = rgbaOf(3, 2, (x, y) => [x * 80, y * 120, 200, 255 - x]);

  test('シグネチャの判定でPNGになり、寸法の読み取りで元の幅と高さになる', async () => {
    const png = await encodePng(image);

    expect(Array.from(png.subarray(0, 8))).toEqual(PNG_SIGNATURE);
    expect(detectSignature(png.subarray(0, 12))).toBe('image/png');
    expect(readImageDimensions(png, 'image/png')).toEqual({
      width: 3,
      height: 2,
    });
  });

  test('IHDR・IDAT・IENDの順の塊を持ち、各塊のCRCが正しい', async () => {
    const chunks = readChunks(await encodePng(image));

    expect(chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    for (const chunk of chunks) {
      expect(chunk.crc).toBe(crcOf(chunk));
    }
    expect(chunks[2]?.data.length).toBe(0);
  });

  test('IHDRは8ビットのRGBA・非インターレースを示す', async () => {
    const header = chunkNamed(await encodePng(image), 'IHDR');
    const view = new DataView(
      header.data.buffer,
      header.data.byteOffset,
      header.data.byteLength,
    );

    expect(header.data.length).toBe(13);
    expect(view.getUint32(0)).toBe(3);
    expect(view.getUint32(4)).toBe(2);
    expect(Array.from(header.data.subarray(8))).toEqual([8, 6, 0, 0, 0]);
  });

  test('IDATを展開すると、各行の先頭がフィルターなしで元の画素がそのまま並ぶ', async () => {
    const idat = chunkNamed(await encodePng(image), 'IDAT');

    const decoded = decodeScanlines(await inflate(idat.data), 3, 2);

    expect(Array.from(decoded.pixels)).toEqual(Array.from(image.pixels));
  });

  test('640×80の画像も符号化でき、寸法を読み戻せる', async () => {
    const png = await encodePng(rgbaOf(640, 80, (x) => [x % 256, 0, 0, 255]));

    expect(readImageDimensions(png, 'image/png')).toEqual({
      width: 640,
      height: 80,
    });
  });

  test.each([
    [{ pixels: new Uint8Array(23), width: 3, height: 2 }],
    [{ pixels: new Uint8Array(25), width: 3, height: 2 }],
    [{ pixels: new Uint8Array(0), width: 0, height: 0 }],
    [{ pixels: new Uint8Array(4), width: 1.5, height: 1 }],
  ])(
    '画素数と寸法が合わない・寸法が正の整数でない画像は例外になる',
    async (invalid) => {
      const error: unknown = await encodePng(invalid).then(
        () => undefined,
        (reason: unknown) => reason,
      );

      expect(error).toBeInstanceOf(RangeError);
    },
  );
});

describe('padRgba', () => {
  const red = rgbaOf(2, 1, () => RED);

  test('縮小した画素をキャンバスの中央に置き、周りを不透明な白で埋める', () => {
    const padded = padRgba(red, { canvasWidth: 4, canvasHeight: 3 });

    expect(padded.width).toBe(4);
    expect(padded.height).toBe(3);
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const inside = y === 1 && (x === 1 || x === 2);
        expect(pixelAt(padded, x, y)).toEqual([...(inside ? RED : WHITE)]);
      }
    }
  });

  test('余白が奇数なら左上の余白を1px少なくし、半透明の画素も値を変えずに置く', () => {
    const padded = padRgba(
      rgbaOf(1, 1, () => BLUE),
      { canvasWidth: 4, canvasHeight: 2 },
    );

    expect(pixelAt(padded, 1, 0)).toEqual([...BLUE]);
    expect(pixelAt(padded, 0, 0)).toEqual([...WHITE]);
    expect(pixelAt(padded, 2, 0)).toEqual([...WHITE]);
    expect(pixelAt(padded, 1, 1)).toEqual([...WHITE]);
  });

  test('キャンバスが画像と同じ寸法なら同じ画素の新しい画像を返し、元の画像を変えない', () => {
    const before = Array.from(red.pixels);

    const padded = padRgba(red, { canvasWidth: 2, canvasHeight: 1 });

    expect(Array.from(padded.pixels)).toEqual(before);
    expect(padded.pixels).not.toBe(red.pixels);
    expect(Array.from(red.pixels)).toEqual(before);
  });

  test('余白を足した640×1の画像を640×80のPNGにすると、寸法の読み取りでキャンバスの寸法になる', async () => {
    const strip = rgbaOf(640, 1, () => RED);

    const png = await encodePng(
      padRgba(strip, { canvasWidth: 640, canvasHeight: 80 }),
    );

    expect(detectSignature(png.subarray(0, 12))).toBe('image/png');
    expect(readImageDimensions(png, 'image/png')).toEqual({
      width: 640,
      height: 80,
    });
  });

  test.each([
    [{ canvasWidth: 1, canvasHeight: 1 }],
    [{ canvasWidth: 2, canvasHeight: 0 }],
    [{ canvasWidth: 2.5, canvasHeight: 1 }],
  ])('キャンバスが画像より小さい・正の整数でない場合は例外になる', (canvas) => {
    expect(() => padRgba(red, canvas)).toThrow(RangeError);
  });

  test('画素数と寸法が合わない画像は例外になる', () => {
    expect(() =>
      padRgba(
        { pixels: new Uint8Array(7), width: 2, height: 1 },
        { canvasWidth: 4, canvasHeight: 4 },
      ),
    ).toThrow(RangeError);
  });
});
