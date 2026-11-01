export interface RgbaImage {
  readonly pixels: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface PadCanvas {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
}

const BYTES_PER_PIXEL = 4;
const PADDING_PIXEL: readonly number[] = Object.freeze([255, 255, 255, 255]);
const PNG_SIGNATURE: readonly number[] = Object.freeze([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const BIT_DEPTH = 8;
const COLOR_TYPE_RGBA = 6;
const FILTER_NONE = 0;
const CHUNK_OVERHEAD_BYTES = 12;

const assertPositiveInteger = (name: string, value: number): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(
      `${name}は正の整数で指定してください: ${String(value)}`,
    );
  }
};

const assertRgbaImage = (image: RgbaImage): void => {
  assertPositiveInteger('width', image.width);
  assertPositiveInteger('height', image.height);
  const expected = image.width * image.height * BYTES_PER_PIXEL;
  if (image.pixels.length !== expected) {
    throw new RangeError(
      `RGBAの画素のバイト数(${String(image.pixels.length)})が寸法から求めた${String(expected)}と一致しません。`,
    );
  }
};

export function padRgba(image: RgbaImage, canvas: PadCanvas): RgbaImage {
  assertRgbaImage(image);
  assertPositiveInteger('canvasWidth', canvas.canvasWidth);
  assertPositiveInteger('canvasHeight', canvas.canvasHeight);
  if (canvas.canvasWidth < image.width || canvas.canvasHeight < image.height) {
    throw new RangeError('キャンバスが画像より小さいです。');
  }
  const pixels = new Uint8Array(
    canvas.canvasWidth * canvas.canvasHeight * BYTES_PER_PIXEL,
  );
  for (let offset = 0; offset < pixels.length; offset += BYTES_PER_PIXEL) {
    pixels.set(PADDING_PIXEL, offset);
  }
  const left = Math.floor((canvas.canvasWidth - image.width) / 2);
  const top = Math.floor((canvas.canvasHeight - image.height) / 2);
  const sourceStride = image.width * BYTES_PER_PIXEL;
  const canvasStride = canvas.canvasWidth * BYTES_PER_PIXEL;
  for (let y = 0; y < image.height; y += 1) {
    pixels.set(
      image.pixels.subarray(y * sourceStride, (y + 1) * sourceStride),
      (top + y) * canvasStride + left * BYTES_PER_PIXEL,
    );
  }
  return Object.freeze({
    pixels,
    width: canvas.canvasWidth,
    height: canvas.canvasHeight,
  });
}

// PNGの塊のCRC(ISO 3309・ITU-T V.42の多項式0xEDB88320)の256通りの表
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const chunkOf = (type: string, data: Uint8Array): Uint8Array => {
  const chunk = new Uint8Array(CHUNK_OVERHEAD_BYTES + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
};

const headerOf = (image: RgbaImage): Uint8Array => {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, image.width);
  view.setUint32(4, image.height);
  header.set([BIT_DEPTH, COLOR_TYPE_RGBA, 0, 0, 0], 8);
  return header;
};

// 各行の先頭にフィルターの種類(なし)の1バイトを付けた、IDATの圧縮前の並び
const scanlinesOf = (image: RgbaImage): Uint8Array<ArrayBuffer> => {
  const stride = image.width * BYTES_PER_PIXEL;
  const scanlines = new Uint8Array((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    scanlines[y * (stride + 1)] = FILTER_NONE;
    scanlines.set(
      image.pixels.subarray(y * stride, (y + 1) * stride),
      y * (stride + 1) + 1,
    );
  }
  return scanlines;
};

// PNGのIDATはzlib形式を求め、CompressionStreamの'deflate'はzlib形式(RFC 1950)を出力する
const zlibCompress = async (
  bytes: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array> =>
  new Uint8Array(
    await new Response(
      new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate')),
    ).arrayBuffer(),
  );

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const result = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

export async function encodePng(image: RgbaImage): Promise<Uint8Array> {
  assertRgbaImage(image);
  const compressed = await zlibCompress(scanlinesOf(image));
  return concat([
    Uint8Array.from(PNG_SIGNATURE),
    chunkOf('IHDR', headerOf(image)),
    chunkOf('IDAT', compressed),
    chunkOf('IEND', new Uint8Array(0)),
  ]);
}
