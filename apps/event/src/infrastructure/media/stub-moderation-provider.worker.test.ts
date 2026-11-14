import { afterEach, describe, expect, test, vi } from 'vitest';

import type {
  ModerationImage,
  ModerationOutcome,
  ModerationProvider,
} from '../../application/media/ports.ts';
import { encodePng } from '../../application/media/png-encoder.ts';
import { StubModerationProvider } from './stub-moderation-provider.ts';

const MIN_CONFIDENCE = 60;

async function pngOf(width: number, height: number): Promise<ModerationImage> {
  const pixels = new Uint8Array(width * height * 4).fill(255);
  return { bytes: await encodePng({ pixels, width, height }), format: 'png' };
}

const JPEG_HEAD_HEX = 'ffd8ffe000104a46494600010100000100010000ffc0001108';
const JPEG_TAIL_HEX = '03012200021101031101ffd9';

// 寸法の読み取りに要るJFIFのAPP0とSOF0の区切りだけを持つ、ベースラインのJPEGの先頭部分
function jpegOf(width: number, height: number): ModerationImage {
  const size = new Uint8Array(4);
  new DataView(size.buffer).setUint16(0, height);
  new DataView(size.buffer).setUint16(2, width);
  return {
    bytes: Uint8Array.from([
      ...Uint8Array.fromHex(JPEG_HEAD_HEX),
      ...size,
      ...Uint8Array.fromHex(JPEG_TAIL_HEX),
    ]),
    format: 'jpeg',
  };
}

const EXPLICIT: ModerationOutcome = {
  kind: 'labels',
  labels: [
    { name: 'Explicit', parentName: '', confidence: 99, taxonomyLevel: 1 },
  ],
};

// 判定の処理と同じくポートの型で呼び、閾値を渡しても結果が変わらないことを確かめる
const stubProvider = (): ModerationProvider => new StubModerationProvider();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StubModerationProvider', () => {
  test.each<[string, number, number, ModerationOutcome]>([
    ['99×99', 99, 99, EXPLICIT],
    ['98×98', 98, 98, { kind: 'transient', reason: 'throttled' }],
    ['97×97', 97, 97, { kind: 'rejected', reason: 'invalid-image' }],
    ['100×100', 100, 100, { kind: 'labels', labels: [] }],
    ['99×98', 99, 98, { kind: 'labels', labels: [] }],
    ['640×80', 640, 80, { kind: 'labels', labels: [] }],
  ])(
    'PNGの判定用画像が%sなら代替の判定の規則の結果を返す',
    async (_label, width, height, expected) => {
      const image = await pngOf(width, height);

      expect(await stubProvider().detect(image, MIN_CONFIDENCE)).toStrictEqual(
        expected,
      );
    },
  );

  test.each<[string, number, number, ModerationOutcome]>([
    ['99×99', 99, 99, EXPLICIT],
    ['98×98', 98, 98, { kind: 'transient', reason: 'throttled' }],
    ['120×90', 120, 90, { kind: 'labels', labels: [] }],
  ])(
    'JPEGの判定用画像が%sなら代替の判定の規則の結果を返す',
    async (_label, width, height, expected) => {
      expect(
        await stubProvider().detect(jpegOf(width, height), MIN_CONFIDENCE),
      ).toStrictEqual(expected);
    },
  );

  test.each<[string, ModerationImage]>([
    ['壊れた本文', { bytes: Uint8Array.from([1, 2, 3, 4]), format: 'png' }],
    ['空の本文', { bytes: new Uint8Array(0), format: 'jpeg' }],
  ])(
    '寸法を読めない%sは判定サービスと同じく画像として受け付けない',
    async (_label, image) => {
      expect(await stubProvider().detect(image, MIN_CONFIDENCE)).toStrictEqual({
        kind: 'rejected',
        reason: 'invalid-image',
      });
    },
  );

  test('申告の形式と本文の形式が違う画像は受け付けない', async () => {
    const png = await pngOf(99, 99);

    expect(
      await stubProvider().detect(
        { bytes: png.bytes, format: 'jpeg' },
        MIN_CONFIDENCE,
      ),
    ).toStrictEqual({ kind: 'rejected', reason: 'invalid-image' });
  });

  test('外部へ通信しない', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const provider = stubProvider();

    await provider.detect(await pngOf(99, 99), MIN_CONFIDENCE);
    await provider.detect(await pngOf(98, 98), MIN_CONFIDENCE);
    await provider.detect(await pngOf(10, 10), MIN_CONFIDENCE);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
