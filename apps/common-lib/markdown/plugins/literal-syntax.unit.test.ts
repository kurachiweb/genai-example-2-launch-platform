import { describe, expect, test } from 'bun:test';

import type {
  MdastHeading,
  MdastHtml,
  MdastImage,
  MdastImageReference,
  MdastNode,
  MdastParent,
  MdastRoot,
  MdastText,
} from '../hast-types.ts';
import { literalizeSyntax } from './literal-syntax.ts';

const LONG_RUN_LENGTH = 20_000;

const MAX_ELAPSED_MILLISECONDS = 50;

const root = (...children: readonly MdastNode[]): MdastRoot => ({
  type: 'root',
  children,
});

const parent = (
  type: string,
  ...children: readonly MdastNode[]
): MdastParent => ({
  type,
  children,
});

const paragraph = (...children: readonly MdastNode[]): MdastParent =>
  parent('paragraph', ...children);

const text = (value: string): MdastText => ({ type: 'text', value });

const html = (value: string): MdastHtml => ({ type: 'html', value });

const heading = (
  depth: MdastHeading['depth'],
  ...children: readonly MdastNode[]
): MdastHeading => ({ type: 'heading', depth, children });

const image = (url: string, alt: string | null): MdastImage => ({
  type: 'image',
  url,
  alt,
});

const imageReference = (
  fields: Omit<MdastImageReference, 'type'>,
): MdastImageReference => ({ type: 'imageReference', ...fields });

describe('literalizeSyntax', () => {
  test.each(['blockquote', 'listItem', 'footnoteDefinition'])(
    'ブロックを持つ%sの直下のRaw HTMLを段落で包んだ文字列にする',
    (containerType) => {
      const tree = root(parent(containerType, html('<div>x</div>')));

      expect(literalizeSyntax(tree)).toEqual(
        root(parent(containerType, paragraph(text('<div>x</div>')))),
      );
    },
  );

  test('ルートの直下のRaw HTMLを段落で包んだ文字列にする', () => {
    expect(literalizeSyntax(root(html('<script>alert(1)</script>')))).toEqual(
      root(paragraph(text('<script>alert(1)</script>'))),
    );
  });

  test('段落の中のRaw HTMLは段落で包まずに文字列にする', () => {
    const tree = root(
      paragraph(text('a '), html('<b>'), text('x'), html('</b>')),
    );

    expect(literalizeSyntax(tree)).toEqual(
      root(paragraph(text('a '), text('<b>'), text('x'), text('</b>'))),
    );
  });

  test('見出しレベル1を先頭に「# 」を加えた段落にし、子の変換も行う', () => {
    const tree = root(heading(1, text('概要'), html('<br>')));

    expect(literalizeSyntax(tree)).toEqual(
      root(paragraph(text('# '), text('概要'), text('<br>'))),
    );
  });

  test('見出しレベル2はそのまま残す', () => {
    const tree = root(heading(2, text('概要')));

    expect(literalizeSyntax(tree)).toEqual(tree);
  });

  test.each([
    [
      '代替テキストとURLを持つ画像',
      image('https://img.example/a.png', '図'),
      '![図](https://img.example/a.png)',
    ],
    [
      '代替テキストが無い画像',
      image('https://img.example/a.png', null),
      '![](https://img.example/a.png)',
    ],
    [
      '完全な参照形式の画像',
      imageReference({
        identifier: 'logo',
        label: 'Logo',
        referenceType: 'full',
        alt: '図',
      }),
      '![図][Logo]',
    ],
    [
      '省略した参照形式の画像',
      imageReference({
        identifier: 'logo',
        label: 'Logo',
        referenceType: 'collapsed',
        alt: 'Logo',
      }),
      '![Logo][]',
    ],
    [
      '短縮した参照形式の画像',
      imageReference({
        identifier: 'logo',
        label: 'Logo',
        referenceType: 'shortcut',
        alt: 'Logo',
      }),
      '![Logo]',
    ],
    [
      'ラベルの無い完全な参照形式の画像は識別子を使う',
      imageReference({ identifier: 'logo', referenceType: 'full', alt: '図' }),
      '![図][logo]',
    ],
  ])('%sを文字列にする', (_, node, expected) => {
    expect(literalizeSyntax(root(paragraph(node)))).toEqual(
      root(paragraph(text(expected))),
    );
  });

  test('入れ子の深い位置の節点も変換する', () => {
    const tree = root(
      parent(
        'list',
        parent(
          'listItem',
          paragraph(parent('link', image('https://img.example/a.png', 'a'))),
        ),
      ),
    );

    expect(literalizeSyntax(tree)).toEqual(
      root(
        parent(
          'list',
          parent(
            'listItem',
            paragraph(parent('link', text('![a](https://img.example/a.png)'))),
          ),
        ),
      ),
    );
  });

  test('元の木を書き換えない', () => {
    const tree = root(html('<hr>'), heading(1, text('a')));
    const snapshot = structuredClone(tree);

    literalizeSyntax(tree);

    expect(tree).toEqual(snapshot);
  });

  test('多数のRaw HTMLの節点を線形の時間で変換する', () => {
    const tree = root(
      paragraph(...Array.from({ length: LONG_RUN_LENGTH }, () => html('<b>'))),
    );

    const startedAt = performance.now();
    const result = literalizeSyntax(tree);
    const elapsed = performance.now() - startedAt;

    expect(result.children[0]?.children).toHaveLength(LONG_RUN_LENGTH);
    expect(elapsed).toBeLessThan(MAX_ELAPSED_MILLISECONDS);
  });
});
