import { describe, expect, test } from 'bun:test';

import { SVG_ALLOWLIST } from './svg-allowlist-table.ts';
import { inspectSvg } from './svg-allowlist.ts';

const ALLOWLIST_DOCUMENT_URL = new URL(
  '../../../../../docs/GUIDES/tech/security/005-file-upload-security.md',
  import.meta.url,
);

const ALLOWLIST_HEADING = '### SVGの許可リスト';

const ALLOWLIST_DETAIL_HEADING = '### 許可リストの全項目';

const EDITOR_NAMESPACE_HEADING = '### 編集ソフトの名前空間';

const CODE_SPAN_PATTERN = /`([^`]+)`/gu;

const ELEMENT_NAME_PATTERN = /^[A-Za-z][A-Za-z-]*$/u;

const FILTER_PRIMITIVE_PREFIX = 'fe';

const ATTRIBUTE_NAME_PREFIX_SUFFIX = '*';

const markdown = await Bun.file(ALLOWLIST_DOCUMENT_URL).text();

const tableRowsOf = (heading: string): readonly (readonly string[])[] => {
  const lines = markdown.split('\n');
  const headingIndex = lines.indexOf(heading);
  if (headingIndex === -1) {
    throw new Error(`技術ドキュメントに「${heading}」の節がありません。`);
  }
  const tableStart = lines.findIndex(
    (line, index) => index > headingIndex && line.startsWith('|'),
  );
  const tableEnd = lines.findIndex(
    (line, index) => index > tableStart && !line.startsWith('|'),
  );
  // 表の先頭の2行は見出しと区切りのため、3行目からを値の行とする
  return lines.slice(tableStart + 2, tableEnd).map((line) =>
    line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim()),
  );
};

const firstColumnMapOf = (heading: string): ReadonlyMap<string, string> =>
  new Map(
    tableRowsOf(heading).map(([category = '', allowed = '']) => [
      category,
      allowed,
    ]),
  );

const rows = firstColumnMapOf(ALLOWLIST_HEADING);

const detailRows = firstColumnMapOf(ALLOWLIST_DETAIL_HEADING);

const cellIn = (
  table: ReadonlyMap<string, string>,
  heading: string,
  category: string,
): string => {
  const cell = table.get(category);
  if (cell === undefined) {
    throw new Error(`「${heading}」の表に「${category}」の行がありません。`);
  }
  return cell;
};

const cellOf = (category: string): string =>
  cellIn(rows, ALLOWLIST_HEADING, category);

const detailCellOf = (category: string): string =>
  cellIn(detailRows, ALLOWLIST_DETAIL_HEADING, category);

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

describe('SVGの許可リストと技術ドキュメントの表の一致', () => {
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
      (name) => name !== FILTER_PRIMITIVE_PREFIX && name !== 'feImage',
    );
    const filterPrimitives = SVG_ALLOWLIST.paintAndEffectElements.filter(
      (name) => !named.includes(name),
    );

    expect(named.every((name) => ALL_ELEMENTS.has(name))).toBe(true);
    expect(filterPrimitives.length).toBeGreaterThan(0);
    expect(
      filterPrimitives.every((name) =>
        name.startsWith(FILTER_PRIMITIVE_PREFIX),
      ),
    ).toBe(true);
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

  // 判定用画像の描画器がWebPを描かないため、要件7.5のWebPを開発者の決定(2026-11-01)で外した
  test('許可するdata URIの画像の形式がJPEG・PNG・GIFである', () => {
    expect(sorted(SVG_ALLOWLIST.dataUriImageTypes)).toEqual(
      sorted(['gif', 'jpeg', 'png']),
    );
  });
});

describe('許可リストの全項目と技術ドキュメントの一覧の一致', () => {
  test('フィルタの要素の一覧が許可リストのfeで始まる要素と一致する', () => {
    expect(
      sorted(
        SVG_ALLOWLIST.paintAndEffectElements.filter((name) =>
          name.startsWith(FILTER_PRIMITIVE_PREFIX),
        ),
      ),
    ).toEqual(sorted(codeSpansOf(detailCellOf('フィルタの要素'))));
  });

  test.each([
    ['共通の属性', SVG_ALLOWLIST.coreAttributes],
    ['幾何の属性', SVG_ALLOWLIST.geometryAttributes],
    ['塗り・切り抜き・マスクの属性', SVG_ALLOWLIST.paintServerAttributes],
    ['フィルタの属性', SVG_ALLOWLIST.filterAttributes],
    ['表示属性', SVG_ALLOWLIST.presentationAttributes],
    [
      'XML・XLinkの属性',
      [...SVG_ALLOWLIST.xmlAttributes, ...SVG_ALLOWLIST.xlinkAttributes],
    ],
  ] as const)('%sの一覧が許可リストと一致する', (category, names) => {
    expect(sorted(names)).toEqual(sorted(codeSpansOf(detailCellOf(category))));
  });

  test('接頭辞で許可する属性の一覧が許可リストの接頭辞と一致する', () => {
    const prefixes = codeSpansOf(detailCellOf('接頭辞で許可する属性')).map(
      (name) =>
        name.endsWith(ATTRIBUTE_NAME_PREFIX_SUFFIX) ? name.slice(0, -1) : name,
    );

    expect(sorted(prefixes)).toEqual(
      sorted(SVG_ALLOWLIST.attributeNamePrefixes),
    );
  });

  test('編集ソフトの名前空間の一覧が許可リストの名前空間と一致する', () => {
    const documented = tableRowsOf(EDITOR_NAMESPACE_HEADING).map(
      ([editor = '', prefix = '', uri = '']) =>
        [editor, ...codeSpansOf(prefix), ...codeSpansOf(uri)].join(' '),
    );
    const implemented = SVG_ALLOWLIST.editorNamespaces.map(
      ({ editor, prefix, uri }) => [editor, prefix, uri].join(' '),
    );

    expect(sorted(documented)).toEqual(sorted(implemented));
  });
});
