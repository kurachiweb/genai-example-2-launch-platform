import { describe, expect, test } from 'bun:test';

import { SVG_ALLOWLIST } from './svg-allowlist-table.ts';
import { inspectSvg } from './svg-allowlist.ts';

const ALLOWLIST_DOCUMENT_URL = new URL(
  '../../../../../.kiro/specs/media-pipeline/design.md',
  import.meta.url,
);

const ALLOWLIST_HEADING = '### SVGの許可リスト(初版)';

const CODE_SPAN_PATTERN = /`([^`]+)`/gu;

const ELEMENT_NAME_PATTERN = /^[A-Za-z][A-Za-z-]*$/u;

const allowlistRowsOf = (markdown: string): ReadonlyMap<string, string> => {
  const lines = markdown.split('\n');
  const headingIndex = lines.indexOf(ALLOWLIST_HEADING);
  if (headingIndex === -1) {
    throw new Error(`設計に「${ALLOWLIST_HEADING}」の節がありません。`);
  }
  const tableStart = lines.findIndex(
    (line, index) => index > headingIndex && line.startsWith('|'),
  );
  const tableEnd = lines.findIndex(
    (line, index) => index > tableStart && !line.startsWith('|'),
  );
  // 表の先頭の2行は見出しと区切りのため、3行目からを値の行とする
  const rows = lines.slice(tableStart + 2, tableEnd).map((line) =>
    line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim()),
  );
  return new Map(
    rows.map(([category = '', allowed = '']) => [category, allowed]),
  );
};

const rows = allowlistRowsOf(await Bun.file(ALLOWLIST_DOCUMENT_URL).text());

const cellOf = (category: string): string => {
  const cell = rows.get(category);
  if (cell === undefined) {
    throw new Error(`許可リストの表に「${category}」の行がありません。`);
  }
  return cell;
};

const codeSpansOf = (cell: string): readonly string[] =>
  [...cell.matchAll(CODE_SPAN_PATTERN)].map((match) => match[1] ?? '');

const sorted = (names: readonly string[]): readonly string[] =>
  [...names].sort((left, right) => left.localeCompare(right));

const ALL_ATTRIBUTES: ReadonlySet<string> = new Set([
  ...SVG_ALLOWLIST.coreAttributes,
  ...SVG_ALLOWLIST.geometryAttributes,
  ...SVG_ALLOWLIST.paintServerAttributes,
  ...SVG_ALLOWLIST.filterAttributes,
  ...SVG_ALLOWLIST.presentationAttributes,
  ...SVG_ALLOWLIST.xmlAttributes,
  ...SVG_ALLOWLIST.xlinkAttributes,
]);

const ALL_ELEMENTS: ReadonlySet<string> = new Set([
  ...SVG_ALLOWLIST.structureElements,
  ...SVG_ALLOWLIST.shapeAndTextElements,
  ...SVG_ALLOWLIST.paintAndEffectElements,
]);

describe('SVGの許可リストと設計の表の一致', () => {
  test('構造の要素が表と一致する', () => {
    expect(sorted(SVG_ALLOWLIST.structureElements)).toEqual(
      sorted(codeSpansOf(cellOf('構造の要素'))),
    );
  });

  test('図形・文字の要素が表と一致する', () => {
    expect(sorted(SVG_ALLOWLIST.shapeAndTextElements)).toEqual(
      sorted(codeSpansOf(cellOf('図形・文字の要素'))),
    );
  });

  test('塗り・効果の要素は表の要素とfeで始まるフィルタの要素(feImageを除く)からなる', () => {
    const named = codeSpansOf(cellOf('塗り・効果の要素')).filter(
      (name) => name !== 'fe' && name !== 'feImage',
    );
    const filterPrimitives = SVG_ALLOWLIST.paintAndEffectElements.filter(
      (name) => !named.includes(name),
    );

    expect(named.every((name) => ALL_ELEMENTS.has(name))).toBe(true);
    expect(filterPrimitives.length).toBeGreaterThan(0);
    expect(filterPrimitives.every((name) => name.startsWith('fe'))).toBe(true);
    expect(ALL_ELEMENTS.has('feImage')).toBe(false);
  });

  test('表に挙げた属性が全て許可される', () => {
    const names = codeSpansOf(cellOf('属性')).filter(
      (name) => name !== 'xmlns' && name !== 'xmlns:*',
    );

    expect(names.filter((name) => !ALL_ATTRIBUTES.has(name))).toEqual([]);
  });

  test('表に挙げた編集ソフトの名前空間と接頭辞が許可される', () => {
    const cell = cellOf('編集ソフトの名前空間');
    const editors = cell
      .replace(/\([^)]*`[^)]*\)/gu, '')
      .replace(/の要素と属性$/u, '')
      .split('・');
    const prefixes = codeSpansOf(cell)
      .filter((name) => name !== 'on')
      .map((name) => name.replace(/:$/u, ''));
    const namespaces = SVG_ALLOWLIST.editorNamespaces;

    expect(
      sorted([...new Set(namespaces.map(({ editor }) => editor))]),
    ).toEqual(sorted(editors));
    expect(
      prefixes.filter(
        (prefix) =>
          !namespaces.some((namespace) => namespace.prefix === prefix),
      ),
    ).toEqual([]);
  });

  test('表に挙げた違反にする要素は許可リストに無く、違反として記録される', () => {
    const elements = codeSpansOf(cellOf('違反にするもの(例)')).filter((name) =>
      ELEMENT_NAME_PATTERN.test(name),
    );

    expect(elements.length).toBeGreaterThan(0);
    for (const name of elements) {
      expect(ALL_ELEMENTS.has(name)).toBe(false);
      expect(
        inspectSvg(`<svg xmlns="http://www.w3.org/2000/svg"><${name}/></svg>`),
      ).toEqual({
        ok: false,
        violations: [{ kind: 'disallowed-element', target: name }],
      });
    }
  });

  test('許可するdata URIの画像の形式がJPEG・PNG・GIF・WebPである', () => {
    expect(sorted(SVG_ALLOWLIST.dataUriImageTypes)).toEqual(
      sorted(['gif', 'jpeg', 'png', 'webp']),
    );
  });
});
