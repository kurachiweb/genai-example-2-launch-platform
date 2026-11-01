import { env } from 'cloudflare:workers';

const GIF_HEADER = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

// 幅1・高さ1、2色のグローバルカラーテーブル(0番が赤、1番が青)
const GIF_SCREEN_AND_PALETTE = [
  0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00, 0x00, 0xff,
];

const GIF_LOOP_FOREVER = [
  0x21,
  0xff,
  0x0b,
  ...new TextEncoder().encode('NETSCAPE2.0'),
  0x03,
  0x01,
  0x00,
  0x00,
  0x00,
];

const GIF_FRAME_DELAY = [0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00];

const GIF_FULL_FRAME = [0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00];

// 最小符号長2のLZWで、消去・色番号・終端の3符号だけを持つ1画素の画像データ
const GIF_PIXEL_DATA: Readonly<Record<0 | 1, readonly number[]>> = {
  0: [0x00, 0x02, 0x02, 0x44, 0x01, 0x00],
  1: [0x00, 0x02, 0x02, 0x4c, 0x01, 0x00],
};

const GIF_TRAILER = 0x3b;

const frameOf = (colorIndex: 0 | 1): number[] => [
  ...GIF_FRAME_DELAY,
  ...GIF_FULL_FRAME,
  ...GIF_PIXEL_DATA[colorIndex],
];

// 1フレーム目が赤、2フレーム目が青の1×1のGIFアニメーション
export const animatedGif = (): Uint8Array =>
  new Uint8Array([
    ...GIF_HEADER,
    ...GIF_SCREEN_AND_PALETTE,
    ...GIF_LOOP_FOREVER,
    ...frameOf(0),
    ...frameOf(1),
    GIF_TRAILER,
  ]);

export const objectKeyFor = (index: number): string =>
  index.toString(16).padStart(32, '0');

export const streamOf = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new Blob([bytes]).stream() as ReadableStream<Uint8Array>;

export async function bytesOf(
  body: ReadableStream<Uint8Array> | null,
): Promise<Uint8Array> {
  return new Uint8Array(await new Response(body).arrayBuffer());
}

export async function putImage(
  objectKey: string,
  body: Uint8Array | string,
  contentType?: string,
): Promise<void> {
  await env.IMAGES_BUCKET.put(
    objectKey,
    body,
    contentType === undefined ? {} : { httpMetadata: { contentType } },
  );
}

export async function clearImageBuckets(): Promise<void> {
  for (const bucket of [env.IMAGES_BUCKET, env.QUARANTINE_BUCKET]) {
    const listed = await bucket.list();
    if (listed.objects.length > 0) {
      await bucket.delete(listed.objects.map((object) => object.key));
    }
  }
}
