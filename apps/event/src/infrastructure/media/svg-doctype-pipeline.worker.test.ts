import { describe, expect, test } from 'vitest';

import { readImageDimensions } from '../../../lib/core/media/image-dimensions.ts';
import { checkSvgSyntax } from '../../../lib/core/media/svg-syntax.ts';
import { inspectSvg } from '../../application/media/svg-allowlist.ts';
import {
  BLUE,
  decode,
  encode,
  pixelAt,
  RED,
  renderer,
  renderOk,
  svgPlanFor,
} from './wasm-moderation-image-renderer.fixtures.ts';

const SVG_11_DOCTYPE =
  '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">';

const ILLUSTRATOR_SVG_11_EXPORT = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generator: Adobe Illustrator 16.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->
${SVG_11_DOCTYPE}
<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px"
	 width="200px" height="100px" viewBox="0 0 200 100" enable-background="new 0 0 200 100" xml:space="preserve">
<rect fill="#FF0000" width="100" height="100"/>
<rect x="100" fill="#0000FF" width="100" height="100"/>
</svg>
`;

const AFFINITY_EXPORT = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"
  "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="100%" height="100%" viewBox="0 0 200 100" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" xmlns:serif="http://www.serif.com/" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:2;">
    <g id="Artboard1" serif:id="Artboard 1">
        <rect x="0" y="0" width="100" height="100" style="fill:rgb(255,0,0);"/>
        <rect x="100" y="0" width="100" height="100" style="fill:rgb(0,0,255);"/>
    </g>
</svg>
`;

describe('標準の文書型宣言を持つ編集ソフトの書き出しの受付から判定用の描画まで', () => {
  test.each([
    ['Illustrator(SVG 1.1)', ILLUSTRATOR_SVG_11_EXPORT],
    ['Affinity Designer', AFFINITY_EXPORT],
  ])(
    '%sの書き出しは受付・寸法の読み取り・許可リストを通り、内容どおりに描かれる',
    async (_label, text) => {
      const original = encode(text);

      expect(checkSvgSyntax(original)).toStrictEqual({ ok: true, text });
      expect(readImageDimensions(original, 'image/svg+xml')).toStrictEqual({
        width: 200,
        height: 100,
      });
      expect(inspectSvg(text)).toStrictEqual({ ok: true });

      const plan = svgPlanFor(original);
      const decoded = await decode((await renderOk(original, plan)).bytes);

      expect(pixelAt(decoded, 50, 50)).toStrictEqual(RED);
      expect(pixelAt(decoded, 150, 50)).toStrictEqual(BLUE);
    },
  );

  // 外部のDTDを持つ文書では、ブラウザが未宣言の実体参照を致命的な誤りにせず残りを表示し得るため、判定用画像を作れない側(隔離)へ倒れることを確かめる
  test('標準の文書型宣言と未宣言の実体参照を持つ文書は、判定用画像を作れず復号できない結果になる', async () => {
    const original = encode(
      `${SVG_11_DOCTYPE}<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/><text>a&nbsp;b</text></svg>`,
    );

    expect(checkSvgSyntax(original).ok).toBe(true);
    expect(
      await renderer().render({ original, plan: svgPlanFor(original) }),
    ).toStrictEqual({ ok: false, reason: 'undecodable' });
  });
});
