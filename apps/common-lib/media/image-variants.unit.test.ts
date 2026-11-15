import { describe, expect, expectTypeOf, test } from 'bun:test';

import {
  buildImagePath,
  IMAGE_CACHE_CONTROL,
  IMAGE_VARIANTS,
  type ImageExtension,
  type ImageVariantName,
  isDeliverable,
  OBJECT_KEY_PATTERN,
  parseImagePath,
  screenshotVariants,
  squareVariants,
} from './image-variants.ts';

const OBJECT_KEY = '0123456789abcdef'.repeat(2);

const VARIANT_NAMES: readonly ImageVariantName[] = [
  'square-xs',
  'square-sm',
  'square-md',
  'square-lg',
  'screenshot-thumb',
  'screenshot-thumb-2x',
  'screenshot-full',
];

const EXTENSIONS: readonly ImageExtension[] = [
  'avif',
  'webp',
  'jpg',
  'png',
  'svg',
];

const ORIGINALS = ['svg', 'raster'] as const;

const SPEC_DOCUMENT_URL = new URL(
  '../../../docs/GUIDES/service/features/002-image-variants.md',
  import.meta.url,
);

const CODE_SPAN_PATTERN = /`([^`]+)`/;

const SIZE_PATTERN = /(\d+)×(\d+)px/;

const EXCEPT_VARIANT_PATTERN = /^`([^`]+)`以外$/;

const tableRowsOf = (markdown: string, heading: string): string[][] => {
  const section = markdown
    .split(/^## /m)
    .find((part) => part.startsWith(heading));
  if (section === undefined) {
    throw new Error(`画像バリアント仕様に「${heading}」の節がありません。`);
  }
  const lines = section.split('\n');
  const tableStart = lines.findIndex((line) => line.startsWith('|'));
  const tableEnd = lines.findIndex(
    (line, index) => index > tableStart && !line.startsWith('|'),
  );
  // 表の先頭の2行は見出しと区切りのため、3行目からを値の行とする
  return lines
    .slice(tableStart + 2, tableEnd === -1 ? undefined : tableEnd)
    .map((line) =>
      line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim()),
    );
};

const codeOf = (cell: string | undefined): string => {
  const match = CODE_SPAN_PATTERN.exec(cell ?? '');
  if (match?.[1] === undefined) {
    throw new Error(`インラインコードの無い表のセルです: ${cell ?? '(無し)'}`);
  }
  return match[1];
};

const specDocument = await Bun.file(SPEC_DOCUMENT_URL).text();

describe('バリアントの表', () => {
  test('画像バリアント仕様の7バリアントの寸法・切り取り方・AVIFの提供可否を持つ', () => {
    expect(IMAGE_VARIANTS).toEqual({
      'square-xs': {
        name: 'square-xs',
        width: 32,
        height: 32,
        fit: 'cover',
        avif: true,
      },
      'square-sm': {
        name: 'square-sm',
        width: 64,
        height: 64,
        fit: 'cover',
        avif: true,
      },
      'square-md': {
        name: 'square-md',
        width: 128,
        height: 128,
        fit: 'cover',
        avif: true,
      },
      'square-lg': {
        name: 'square-lg',
        width: 256,
        height: 256,
        fit: 'cover',
        avif: true,
      },
      'screenshot-thumb': {
        name: 'screenshot-thumb',
        width: 480,
        height: 480,
        fit: 'scale-down',
        avif: true,
      },
      'screenshot-thumb-2x': {
        name: 'screenshot-thumb-2x',
        width: 960,
        height: 960,
        fit: 'scale-down',
        avif: true,
      },
      'screenshot-full': {
        name: 'screenshot-full',
        width: 1920,
        height: 1920,
        fit: 'scale-down',
        avif: false,
      },
    });
  });

  test('表とその要素を書き換えられない', () => {
    expect(Object.isFrozen(IMAGE_VARIANTS)).toBe(true);
    for (const spec of Object.values(IMAGE_VARIANTS)) {
      expect(Object.isFrozen(spec)).toBe(true);
    }
  });

  test('AVIFは長辺が1,200px以下のバリアントだけに提供する', () => {
    for (const spec of Object.values(IMAGE_VARIANTS)) {
      expect(spec.avif).toBe(Math.max(spec.width, spec.height) <= 1200);
    }
  });

  test('画像バリアント仕様のバリアント一覧の表と名前・寸法・切り取り方が一致する', () => {
    const rows = tableRowsOf(specDocument, 'バリアント一覧');
    const documented = rows.map(([name, size, fit]) => {
      const dimensions = SIZE_PATTERN.exec(size ?? '');
      return {
        name: codeOf(name),
        width: Number(dimensions?.[1]),
        height: Number(dimensions?.[2]),
        fit: codeOf(fit),
      };
    });
    expect(documented).toEqual(
      Object.values(IMAGE_VARIANTS).map(({ name, width, height, fit }) => ({
        name,
        width,
        height,
        fit,
      })),
    );
  });

  test('画像バリアント仕様の出力フォーマットの表と配信できる組み合わせが一致する', () => {
    const rows = tableRowsOf(specDocument, '出力フォーマット');
    expect(rows.map(([extension]) => codeOf(extension))).toEqual([
      ...EXTENSIONS,
    ]);
    for (const [extensionCell, , originalCell = '', variantCell = ''] of rows) {
      const extension = codeOf(extensionCell) as ImageExtension;
      const documentedOriginal = originalCell.startsWith('SVGのみ')
        ? 'svg'
        : 'raster';
      const excludedVariant = EXCEPT_VARIANT_PATTERN.exec(variantCell)?.[1];
      for (const variant of VARIANT_NAMES) {
        for (const original of ORIGINALS) {
          expect({
            variant,
            extension,
            original,
            deliverable: isDeliverable(variant, extension, original),
          }).toEqual({
            variant,
            extension,
            original,
            deliverable:
              original === documentedOriginal && variant !== excludedVariant,
          });
        }
      }
    }
  });
});

describe('定数', () => {
  test('正常な応答のCache-Controlは14日の長期キャッシュである', () => {
    expect(IMAGE_CACHE_CONTROL).toBe('public, max-age=1209600, immutable');
    expect(1_209_600).toBe(14 * 24 * 60 * 60);
  });

  test.each([
    [OBJECT_KEY, true],
    ['0123456789abcdef0123456789abcdef', true],
    ['F3A9C1E7B2D84A6F9C0E5B3A7D1F2C48', false],
    [OBJECT_KEY.slice(0, 31), false],
    [`${OBJECT_KEY}0`, false],
    [`${OBJECT_KEY.slice(0, 31)}g`, false],
    ['', false],
    [`${OBJECT_KEY}\n`, false],
  ])('オブジェクトキー%pの形式の一致は%pである', (key, expected) => {
    expect(OBJECT_KEY_PATTERN.test(key)).toBe(expected);
  });
});

describe('buildImagePath', () => {
  test('オブジェクトキー・バリアント名・拡張子からパスを組み立てる', () => {
    expect(buildImagePath(OBJECT_KEY, 'square-md', 'avif')).toBe(
      `/${OBJECT_KEY}/square-md.avif`,
    );
  });

  test('組み立てたパスは解析で元の値に戻る', () => {
    for (const variant of VARIANT_NAMES) {
      for (const extension of EXTENSIONS) {
        expect(
          parseImagePath(buildImagePath(OBJECT_KEY, variant, extension)),
        ).toEqual({ kind: 'image', objectKey: OBJECT_KEY, variant, extension });
      }
    }
  });
});

describe('parseImagePath', () => {
  test('画像のURLの形式のパスからオブジェクトキー・バリアント名・拡張子を取り出す', () => {
    expect(parseImagePath(`/${OBJECT_KEY}/screenshot-thumb-2x.webp`)).toEqual({
      kind: 'image',
      objectKey: OBJECT_KEY,
      variant: 'screenshot-thumb-2x',
      extension: 'webp',
    });
  });

  test.each([
    ['未定義のバリアント名', `/${OBJECT_KEY}/square-xl.webp`],
    ['未定義の拡張子', `/${OBJECT_KEY}/square-md.gif`],
    ['jpegの綴りの拡張子', `/${OBJECT_KEY}/square-md.jpeg`],
    ['大文字の拡張子', `/${OBJECT_KEY}/square-md.JPG`],
    ['大文字のバリアント名', `/${OBJECT_KEY}/Square-md.jpg`],
    ['二重の拡張子', `/${OBJECT_KEY}/square-md.jpg.webp`],
    ['原本を指す名前', `/${OBJECT_KEY}/original.png`],
    ['Objectの既定のプロパティ名', `/${OBJECT_KEY}/constructor.png`],
    [
      '拡張子に当たるObjectの既定のプロパティ名',
      `/${OBJECT_KEY}/square-md.toString`,
    ],
  ])('%sは形は合うが未定義のバリアントとする', (_, pathname) => {
    expect(parseImagePath(pathname)).toEqual({ kind: 'undefined-variant' });
  });

  test.each([
    [
      '大文字の16進のオブジェクトキー',
      `/${OBJECT_KEY.toUpperCase()}/square-md.jpg`,
    ],
    ['31文字のオブジェクトキー', `/${OBJECT_KEY.slice(0, 31)}/square-md.jpg`],
    ['33文字のオブジェクトキー', `/${OBJECT_KEY}0/square-md.jpg`],
    [
      '16進でない文字を含むオブジェクトキー',
      `/${OBJECT_KEY.slice(0, 31)}z/square-md.jpg`,
    ],
    ['余分な前の階層', `/images/${OBJECT_KEY}/square-md.jpg`],
    ['余分な後の階層', `/${OBJECT_KEY}/square-md/extra.jpg`],
    ['末尾の区切り', `/${OBJECT_KEY}/square-md.jpg/`],
    ['二重の区切り', `//${OBJECT_KEY}/square-md.jpg`],
    ['バリアントの無い原本', `/${OBJECT_KEY}`],
    ['バリアントの無い原本の拡張子付き', `/${OBJECT_KEY}.png`],
    ['オブジェクトキーの下の区切りだけ', `/${OBJECT_KEY}/`],
    ['拡張子の無いバリアント名', `/${OBJECT_KEY}/square-md`],
    ['空の拡張子', `/${OBJECT_KEY}/square-md.`],
    ['空のバリアント名', `/${OBJECT_KEY}/.jpg`],
    ['先頭の区切りが無い', `${OBJECT_KEY}/square-md.jpg`],
    ['ルート', '/'],
    ['空', ''],
    ['他の経路', '/webhooks/stripe'],
  ])('%sは画像のURLの形式に合わない', (_, pathname) => {
    expect(parseImagePath(pathname)).toEqual({ kind: 'not-image-path' });
  });
});

describe('isDeliverable', () => {
  test('SVG原本は全バリアントでsvgだけを配信する', () => {
    for (const variant of VARIANT_NAMES) {
      for (const extension of EXTENSIONS) {
        expect(isDeliverable(variant, extension, 'svg')).toBe(
          extension === 'svg',
        );
      }
    }
  });

  test('ラスター原本はsvgを配信せず、screenshot-fullのavifも配信しない', () => {
    for (const variant of VARIANT_NAMES) {
      for (const extension of EXTENSIONS) {
        const expected =
          extension !== 'svg' &&
          !(variant === 'screenshot-full' && extension === 'avif');
        expect(isDeliverable(variant, extension, 'raster')).toBe(expected);
      }
    }
  });

  test.each([
    ['square-xs', 'avif'],
    ['screenshot-thumb-2x', 'avif'],
    ['screenshot-full', 'webp'],
    ['screenshot-full', 'jpg'],
    ['screenshot-full', 'png'],
  ] as const)('ラスター原本の%sの%sを配信する', (variant, extension) => {
    expect(isDeliverable(variant, extension, 'raster')).toBe(true);
  });
});

describe('表示サイズとバリアントの対応', () => {
  test.each([
    [32, 'square-xs', 'square-sm'],
    [64, 'square-sm', 'square-md'],
    [128, 'square-md', 'square-lg'],
  ] as const)(
    '正方形の表示サイズ%ipxは1xが%s・2xが%sである',
    (size, x1, x2) => {
      expect(squareVariants(size)).toEqual({ x1, x2 });
    },
  );

  test('正方形の1xのバリアントの寸法は表示サイズと同じで、2xはその2倍である', () => {
    for (const size of [32, 64, 128] as const) {
      const { x1, x2 } = squareVariants(size);
      expect(IMAGE_VARIANTS[x1].width).toBe(size);
      expect(x2 === undefined ? undefined : IMAGE_VARIANTS[x2].width).toBe(
        size * 2,
      );
    }
  });

  test('スクリーンショットのサムネイルは1xがscreenshot-thumb・2xがscreenshot-thumb-2xである', () => {
    expect(screenshotVariants('thumb')).toEqual({
      x1: 'screenshot-thumb',
      x2: 'screenshot-thumb-2x',
    });
  });

  test('スクリーンショットの拡大表示は1xがscreenshot-fullで、2xのバリアントは無い', () => {
    expect(screenshotVariants('full')).toEqual({
      x1: 'screenshot-full',
      x2: undefined,
    });
  });

  test('表示サイズの引数は正方形の3種とスクリーンショットの2種に限る', () => {
    expectTypeOf<Parameters<typeof squareVariants>[0]>().toEqualTypeOf<
      32 | 64 | 128
    >();
    expectTypeOf<Parameters<typeof screenshotVariants>[0]>().toEqualTypeOf<
      'thumb' | 'full'
    >();
  });
});
