import { commands } from 'vitest/browser';

import {
  IMAGE_VARIANTS,
  type ImageExtension,
  type ImageVariantName,
} from '../../common-lib/media/image-variants.ts';

// 共通部品のディレクトリからの相対パス。Git管理外のテストの出力の置き場所に書き出す
const SERVED_DIR = '.vitest-attachments/served-media-images';

const RASTER_EXTENSIONS: readonly ImageExtension[] = [
  'avif',
  'webp',
  'jpg',
  'png',
];

// 寸法を持たずviewBoxだけを持つSVG(利用者がアップロードし得る形)
const VIEWBOX_ONLY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#0a7"/></svg>';

const PIXEL_SIZE = 16;

// new URL(<パス>, import.meta.url)の形はViteが資源の読み込みとして書き換えるため、モジュールのURLを変数に受けてから解決する
const MODULE_URL = import.meta.url;

async function pngBase64(): Promise<string> {
  const canvas = new OffscreenCanvas(PIXEL_SIZE, PIXEL_SIZE);
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('配信する画像を描けません。');
  }
  context.fillStyle = '#0a7';
  context.fillRect(0, 0, PIXEL_SIZE, PIXEL_SIZE);
  const bytes = new Uint8Array(
    await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer(),
  );
  return btoa(Array.from(bytes, (byte) => String.fromCodePoint(byte)).join(''));
}

export interface ServedMediaImages {
  // MediaImageViewのobjectKeyと組み合わせて配信のURLになるオリジン
  readonly origin: string;
  readonly remove: () => Promise<void>;
}

// テストの開発サーバーから、画像配信と同じ「<オリジン>/<キー>/<バリアント>.<拡張子>」の形で画像を配信する。ブラウザは拡張子ではなく内容で画像を判別するため、ラスター画像の全ての拡張子に同じPNGを置く
// テストのファイルは並行に動いて書き出し先を共有し、片方の後片付けが他方の配信中の画像を消すため、キーはテストのファイルごとに変える
export async function serveMediaImages(
  objectKey: string,
): Promise<ServedMediaImages> {
  const png = await pngBase64();
  const variants = Object.keys(IMAGE_VARIANTS) as ImageVariantName[];
  const files = variants.flatMap((variant) => [
    ...RASTER_EXTENSIONS.map((extension) => ({
      path: `${SERVED_DIR}/${objectKey}/${variant}.${extension}`,
      content: png,
      encoding: 'base64' as const,
    })),
    {
      path: `${SERVED_DIR}/${objectKey}/${variant}.svg`,
      content: VIEWBOX_ONLY_SVG,
      encoding: 'utf8' as const,
    },
  ]);
  await Promise.all(
    files.map(({ path, content, encoding }) =>
      commands.writeFile(path, content, encoding),
    ),
  );
  return {
    origin: new URL(`../${SERVED_DIR}`, MODULE_URL).href,
    remove: async () => {
      await Promise.all(files.map(({ path }) => commands.removeFile(path)));
    },
  };
}
