import { imageSize } from 'image-size';
import { describe, expect, test } from 'vitest';
import { optimizeImage } from 'wasm-image-optimization/workerd';

import { WasmModerationImageRenderer } from './wasm-moderation-image-renderer.ts';
import {
  BLUE,
  type DecodedImage,
  decode,
  encode,
  expectQuarteredContent,
  LIME,
  pixelAt,
  quarteredContent,
  RED,
  renderer,
  renderOk,
  svgOf,
  svgPlanFor,
  WHITE,
} from './wasm-moderation-image-renderer.fixtures.ts';

const LARGE_SVG_TIMEOUT_MS = 30_000;

// PNGのシグネチャ(8バイト)とIHDRの塊(25バイト)の後の、最初の塊(IDAT)の位置
const PNG_FIRST_CHUNK_AFTER_HEADER = 33;

// 大きく描いた2文字が判定用画像に占める緑の画素の割合の下限
const MIN_DRAWN_TEXT_RATIO = 0.1;

describe('WasmModerationImageRendererのSVGの描画', () => {
  // 受付と同じく画像の寸法の読み取りで得た寸法(読めなければ判定の処理と同じく640×640)から計画を作る
  describe('SVGの寸法と描く範囲', () => {
    test('正方形でないviewBoxだけのSVGは計画の領域全体に内容を描く', async () => {
      const original = encode(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 50"><rect width="200" height="50" fill="red"/></svg>',
      );
      const plan = svgPlanFor(original);
      expect(plan).toStrictEqual({
        kind: 'pad',
        width: 200,
        height: 50,
        canvasWidth: 200,
        canvasHeight: 80,
      });

      const decoded = await decode((await renderOk(original, plan)).bytes);

      expect(pixelAt(decoded, 100, 14)).toStrictEqual(WHITE);
      expect(pixelAt(decoded, 100, 15)).toStrictEqual(RED);
      expect(pixelAt(decoded, 100, 64)).toStrictEqual(RED);
      expect(pixelAt(decoded, 100, 65)).toStrictEqual(WHITE);
      expect(pixelAt(decoded, 0, 40)).toStrictEqual(RED);
      expect(pixelAt(decoded, 199, 40)).toStrictEqual(RED);
    });

    test('widthだけを宣言したSVGは左端から右端までの内容を描く', async () => {
      const original = encode(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1600" viewBox="0 0 1600 900"><rect width="800" height="900" fill="red"/><rect x="800" width="800" height="900" fill="blue"/></svg>',
      );
      const plan = svgPlanFor(original);
      expect(plan).toStrictEqual({
        kind: 'resize',
        width: 640,
        height: 360,
        format: 'png',
      });

      const image = await renderOk(original, plan);

      expect(imageSize(image.bytes)).toStrictEqual({
        width: 640,
        height: 360,
        type: 'png',
      });
      const decoded = await decode(image.bytes);
      expect(pixelAt(decoded, 0, 180)).toStrictEqual(RED);
      expect(pixelAt(decoded, 639, 180)).toStrictEqual(BLUE);
      expect(pixelAt(decoded, 320, 0)).toStrictEqual(BLUE);
      expect(pixelAt(decoded, 319, 359)).toStrictEqual(RED);
    });

    test('宣言の寸法が20000×20000のSVGも例外にならず計画の寸法で描く', async () => {
      const original = svgOf(20000, 20000, 'red');
      const plan = svgPlanFor(original);
      expect(plan).toStrictEqual({
        kind: 'resize',
        width: 640,
        height: 640,
        format: 'png',
      });

      const image = await renderOk(original, plan);

      expect(imageSize(image.bytes)).toStrictEqual({
        width: 640,
        height: 640,
        type: 'png',
      });
      const decoded = await decode(image.bytes);
      expect(pixelAt(decoded, 0, 0)).toStrictEqual(RED);
      expect(pixelAt(decoded, 639, 639)).toStrictEqual(RED);
    });

    test('描画器が解釈した縦横比と計画の縦横比が違えば、内容を縮めて計画の寸法の中央に置き白で埋める', async () => {
      const original = encode(
        `<!--${'x'.repeat(1_100_000)}--><svg xmlns="http://www.w3.org/2000/svg" width="8000" height="4000"><rect width="8000" height="4000" fill="red"/></svg>`,
      );
      const plan = svgPlanFor(original);
      expect(plan).toStrictEqual({
        kind: 'resize',
        width: 640,
        height: 640,
        format: 'png',
      });

      const decoded = await decode((await renderOk(original, plan)).bytes);

      expect(decoded.width).toBe(640);
      expect(decoded.height).toBe(640);
      expect(pixelAt(decoded, 320, 159)).toStrictEqual(WHITE);
      expect(pixelAt(decoded, 320, 160)).toStrictEqual(RED);
      expect(pixelAt(decoded, 320, 479)).toStrictEqual(RED);
      expect(pixelAt(decoded, 320, 480)).toStrictEqual(WHITE);
    });

    test('描画器が解釈した寸法が計画より縦長なら、高さに合わせて描き左右を白で埋める', async () => {
      const original = encode(
        `<!--${'x'.repeat(1_100_000)}--><svg xmlns="http://www.w3.org/2000/svg" width="4000" height="8000"><rect width="4000" height="8000" fill="red"/></svg>`,
      );
      const plan = svgPlanFor(original);
      expect(plan).toMatchObject({ width: 640, height: 640 });

      const decoded = await decode((await renderOk(original, plan)).bytes);

      expect(pixelAt(decoded, 159, 320)).toStrictEqual(WHITE);
      expect(pixelAt(decoded, 160, 320)).toStrictEqual(RED);
      expect(pixelAt(decoded, 479, 320)).toStrictEqual(RED);
      expect(pixelAt(decoded, 480, 320)).toStrictEqual(WHITE);
      expect(pixelAt(decoded, 320, 0)).toStrictEqual(RED);
      expect(pixelAt(decoded, 320, 639)).toStrictEqual(RED);
    });

    // 復号の部品は乗算済みの値を返すため、PNGの画素データ(フィルター無しで符号化した行)を直接読む
    test('半透明の画素は乗算済みでない色で判定用画像に入れる', async () => {
      const original = encode(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red" fill-opacity="0.5"/></svg>',
      );

      const png = (await renderOk(original, svgPlanFor(original))).bytes;

      const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
      const idatLength = view.getUint32(PNG_FIRST_CHUNK_AFTER_HEADER);
      const idat = png.subarray(
        PNG_FIRST_CHUNK_AFTER_HEADER + 8,
        PNG_FIRST_CHUNK_AFTER_HEADER + 8 + idatLength,
      );
      const scanlines = new Uint8Array(
        await new Response(
          new Blob([idat])
            .stream()
            .pipeThrough(new DecompressionStream('deflate')),
        ).arrayBuffer(),
      );
      const offset = 50 * (100 * 4 + 1) + 1 + 50 * 4;
      const [red, green, blue, alpha = 0] = scanlines.subarray(
        offset,
        offset + 4,
      );
      expect([red, green, blue]).toStrictEqual([255, 0, 0]);
      expect(Math.abs(alpha - 128)).toBeLessThanOrEqual(1);
    });

    // ブラウザの<img>は幅・高さが無く読めない場合も原点からの内容を描くため、隔離せずに原点から内容の右下の端までを描く
    test.each<[string, string]>([
      ['百分率の幅と高さ', 'width="100%" height="100%"'],
      ['幅だけ', 'width="800"'],
      ['幅と高さも無い', ''],
      ['ブラウザが無効とする幅と高さ', 'width="800." height="800px800"'],
    ])(
      'viewBoxが無く%sのSVGは原点からの内容の全体を描く',
      async (_label, attributes) => {
        const original = encode(
          `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${quarteredContent(800)}</svg>`,
        );

        const decoded = await decode(
          (await renderOk(original, svgPlanFor(original))).bytes,
        );

        expectQuarteredContent(decoded);
      },
    );
  });

  // 右下の4分の1だけを緑で塗った内容。ブラウザの<img>が表示する緑を判定用画像も含むことを確かめる
  describe('ブラウザと描画器で解釈が分かれやすい書き方のSVG', () => {
    const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"';
    const cover = (attributes: string, prefix = ''): string =>
      `<svg ${SVG_NS} width="800" height="800">${prefix}${quarteredContent(800)}<rect ${attributes} width="800" height="800" fill="blue"/></svg>`;

    test.each<[string, string]>([
      [
        '`<use href>`で`<defs>`の内容を参照する',
        `<svg ${SVG_NS} width="800" height="800"><defs><g id="c">${quarteredContent(800)}</g></defs><use href="#c"/></svg>`,
      ],
      [
        '`<symbol>`を`<use>`で参照する',
        `<svg ${SVG_NS} width="800" height="800"><defs><symbol id="c" viewBox="0 0 100 100">${quarteredContent(100)}</symbol></defs><use href="#c" width="800" height="800"/></svg>`,
      ],
      [
        'グラデーションの`href`で色の停止点を継承する',
        `<svg ${SVG_NS} width="800" height="800"><defs><linearGradient id="a"><stop offset="0" stop-color="lime"/><stop offset="1" stop-color="lime"/></linearGradient><linearGradient id="b" href="#a"/></defs><rect width="800" height="800" fill="red"/><rect x="400" y="400" width="400" height="400" fill="url(#b)"/></svg>`,
      ],
      [
        '`<style>`のクラスの規則で塗りを変える',
        `<svg ${SVG_NS} width="800" height="800"><style>.a{fill:lime}</style><rect width="800" height="800" fill="red"/><rect class="a" x="400" y="400" width="400" height="400" fill="red"/></svg>`,
      ],
      [
        '`<style>`のクラスの規則で覆いを消す',
        cover('class="c"', '<style>.c{display:none}</style>'),
      ],
      [
        '`<style>`のCSSの`transform`で覆いを潰す',
        cover('class="c"', '<style>.c{transform:matrix(0,0,0,0,0,0)}</style>'),
      ],
      [
        '`<switch>`で条件に合わない覆いを飛ばす',
        `<svg ${SVG_NS} width="800" height="800"><switch><rect systemLanguage="x-none" width="800" height="800" fill="blue"/><g>${quarteredContent(800)}</g></switch></svg>`,
      ],
      [
        '祖先の`visibility="hidden"`を子の`visibility="visible"`で打ち消す',
        `<svg ${SVG_NS} width="800" height="800"><g visibility="hidden"><g visibility="visible">${quarteredContent(800)}</g></g></svg>`,
      ],
      [
        'ルートに`transform`属性を持つ',
        `<svg ${SVG_NS} width="800" height="800" transform="rotate(180)">${quarteredContent(800)}</svg>`,
      ],
      [
        'ルートに`transform`属性とviewBoxを持つ',
        `<svg ${SVG_NS} width="800" height="800" viewBox="0 0 100 100" transform="translate(50 50)">${quarteredContent(100)}</svg>`,
      ],
      [
        'ルートのstyle属性にCSSの`transform`を持つ',
        `<svg ${SVG_NS} width="800" height="800" style="transform:matrix(-1,0,0,-1,0,0)">${quarteredContent(800)}</svg>`,
      ],
      [
        'ルートに`display="none"`を持つ',
        `<svg ${SVG_NS} width="800" height="800" display="none">${quarteredContent(800)}</svg>`,
      ],
      [
        'ルートのstyle属性に`display:none`を持つ',
        `<svg ${SVG_NS} width="800" height="800" style="fill:red;display:none !important">${quarteredContent(800)}</svg>`,
      ],
      [
        '`<style>`の規則でルートを非表示にする',
        `<svg ${SVG_NS} width="800" height="800"><style>svg{display:none}</style>${quarteredContent(800)}</svg>`,
      ],
      [
        'カンマ区切りのviewBoxを持つ',
        `<svg ${SVG_NS} width="8000" height="8000" viewBox="0,0,100,100">${quarteredContent(100)}</svg>`,
      ],
      [
        '文字参照入りのviewBoxを持つ',
        `<svg ${SVG_NS} width="8000" height="8000" viewBox="0&#44;0&#9;1&#48;0 100">${quarteredContent(100)}</svg>`,
      ],
      [
        '区切りの無い連結のviewBoxを持つ',
        `<svg ${SVG_NS} width="8000" height="8000" viewBox="-0-0 100 100">${quarteredContent(100)}</svg>`,
      ],
      [
        'ブラウザが無効とする末尾の`.`のviewBoxを持つ',
        `<svg ${SVG_NS} width="8000" height="8000" viewBox="0 0 100. 100.">${quarteredContent(8000)}</svg>`,
      ],
      [
        '`pc`の幅と高さを持つ',
        `<svg ${SVG_NS} width="500pc" height="500pc">${quarteredContent(8000)}</svg>`,
      ],
      [
        '`em`の幅と高さを持つ',
        `<svg ${SVG_NS} width="500em" height="500em">${quarteredContent(8000)}</svg>`,
      ],
      [
        '1MiBを超えるプロローグの後にルートを置く',
        `<!--${'x'.repeat(1_100_000)}--><svg ${SVG_NS} width="8000" height="8000">${quarteredContent(8000)}</svg>`,
      ],
    ])('%sSVGも右下の緑を判定用画像に描く', async (_label, svg) => {
      const original = encode(svg);

      const decoded = await decode(
        (await renderOk(original, svgPlanFor(original))).bytes,
      );

      expectQuarteredContent(decoded);
    });

    // viewBoxの外の左右の帯は、ルートの縦横比がviewBoxより横長の場合だけブラウザに見える
    test('大文字の単位の高さを持つSVGはブラウザと同じ縦横比で描き、viewBoxの外の左右の帯の緑も描く', async () => {
      const original = encode(
        `<svg ${SVG_NS} width="8000" height="4000PX" viewBox="0 0 100 100"><rect x="-50" width="200" height="100" fill="red"/><rect x="-50" width="50" height="100" fill="lime"/><rect x="100" width="50" height="100" fill="lime"/></svg>`,
      );
      const plan = svgPlanFor(original);
      expect(plan).toStrictEqual({
        kind: 'resize',
        width: 640,
        height: 320,
        format: 'png',
      });

      const decoded = await decode((await renderOk(original, plan)).bytes);

      expect(pixelAt(decoded, 10, 160)).toStrictEqual(LIME);
      expect(pixelAt(decoded, 320, 160)).toStrictEqual(RED);
      expect(pixelAt(decoded, 629, 160)).toStrictEqual(LIME);
    });
  });

  // workerdのCPU時間とメモリの上限の中で描けることを確かめる。描画器は計画の寸法の画素だけを確保する
  // 赤の背景に緑の文字を大きく描き、判定用画像に占める緑の画素の割合で文字が描かれたかを確かめる
  describe('文字', () => {
    const textSvg = (attributes: string, text: string): Uint8Array =>
      encode(
        `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="red"/><text x="0" y="700" font-size="600" fill="lime"${attributes}>${text}</text></svg>`,
      );

    const limeRatioOf = (image: DecodedImage): number => {
      let lime = 0;
      for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
          const [red, green] = pixelAt(image, x, y);
          lime += green > 200 && red < 80 ? 1 : 0;
        }
      }
      return lime / (image.width * image.height);
    };

    // Chromiumの<img>は同じ文書で約14%を緑で描く
    test.each([
      ['書体の指定が無い', ''],
      ['同梱していない書体を指定した', ' font-family="Arial, Helvetica"'],
      ['総称の書体を指定した', ' font-family="serif"'],
      ['太字と斜体を指定した', ' font-weight="bold" font-style="italic"'],
    ])('%sラテン文字の文字を同梱の書体で描く', async (_label, attributes) => {
      const original = textSvg(attributes, 'XX');

      const decoded = await decode(
        (await renderOk(original, svgPlanFor(original))).bytes,
      );

      expect(limeRatioOf(decoded)).toBeGreaterThan(MIN_DRAWN_TEXT_RATIO);
    });

    // 同梱の書体はラテン文字だけを持つため、書体に無い文字(日本語など)は代替の四角形で描かれ、文字の形は判定されない(既知の制限)
    test('同梱の書体に無い日本語の文字は、どの書体にも無い私用領域の文字と同じ代替の形で描かれる', async () => {
      const render = async (text: string): Promise<Uint8Array> => {
        const original = textSvg('', text);
        return (await renderOk(original, svgPlanFor(original))).bytes;
      };

      expect(await render('日本')).toStrictEqual(await render('\uE000\uE001'));
    });
  });

  describe('大きなSVG', () => {
    test(
      '10万個の要素を持つSVGも描く',
      async () => {
        const rects = '<rect width="1" height="1" fill="red"/>'.repeat(100_000);
        const original = encode(
          `<svg xmlns="http://www.w3.org/2000/svg" width="8000" height="8000">${rects}${quarteredContent(8000)}</svg>`,
        );

        const decoded = await decode(
          (await renderOk(original, svgPlanFor(original))).bytes,
        );

        expectQuarteredContent(decoded);
      },
      LARGE_SVG_TIMEOUT_MS,
    );

    // 描画器は読み込みの段階で要素の数を数え、上限を超える文書を読み込まない
    test(
      '`<use>`の参照を12段に重ねて1兆回の複製になるSVGは、要素の数の上限で読み込めず復号できない結果になる',
      async () => {
        const levels = Array.from(
          { length: 12 },
          (_unused, index) =>
            `<g id="l${String(index + 1)}">${`<use href="#l${String(index)}"/>`.repeat(10)}</g>`,
        ).join('');
        const original = encode(
          `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><defs><g id="l0"><rect width="1" height="1"/></g>${levels}</defs>${quarteredContent(800)}<use href="#l12"/></svg>`,
        );

        const result = await renderer().render({
          original,
          plan: svgPlanFor(original),
        });

        expect(result).toStrictEqual({ ok: false, reason: 'undecodable' });
      },
      LARGE_SVG_TIMEOUT_MS,
    );
  });

  describe('描画の失敗', () => {
    test('閉じていないSVGは縮小・余白のどちらの計画でも復号できない結果になる', async () => {
      const original = encode(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect',
      );

      for (const plan of [
        svgPlanFor(original),
        svgPlanFor(svgOf(1280, 320, 'red')),
      ]) {
        expect(await renderer().render({ original, plan })).toStrictEqual({
          ok: false,
          reason: 'undecodable',
        });
      }
    });

    test('ルートを読めない文書は描画器へ渡さず復号できない結果になる', async () => {
      const failing = new WasmModerationImageRenderer(optimizeImage, () =>
        Promise.reject(new Error('描画器へ渡してはいけません。')),
      );

      expect(
        await failing.render({
          original: encode('<html><svg/></html>'),
          plan: svgPlanFor(svgOf(1280, 320, 'red')),
        }),
      ).toStrictEqual({ ok: false, reason: 'undecodable' });
    });

    test('描画器が計画の寸法を超えて描いた画素は、はみ出た行と列を落として計画の寸法にする', async () => {
      const original = svgOf(1280, 320, 'red');
      const plan = svgPlanFor(original);
      const oversized = new WasmModerationImageRenderer(optimizeImage, () =>
        Promise.resolve({
          pixels: new Uint8Array(641 * 161 * 4).fill(255),
          width: 641,
          height: 161,
        }),
      );

      const result = await oversized.render({ original, plan });

      expect(result.ok).toBe(true);
      const bytes = result.ok ? result.image.bytes : new Uint8Array(0);
      expect(imageSize(bytes)).toStrictEqual({
        width: 640,
        height: 160,
        type: 'png',
      });
    });

    test('SVGの読み込み以外の描画の失敗は復号できない結果にせず例外のまま投げる', async () => {
      const failure = new Error('unreachable');
      const failing = new WasmModerationImageRenderer(optimizeImage, () =>
        Promise.reject(failure),
      );
      const original = svgOf(1280, 320, 'red');

      await expect(
        failing.render({ original, plan: svgPlanFor(original) }),
      ).rejects.toBe(failure);
    });
  });
});
