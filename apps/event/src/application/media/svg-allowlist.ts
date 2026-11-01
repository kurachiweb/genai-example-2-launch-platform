import { XMLParser } from 'fast-xml-parser';

import { SVG_MAX_NESTED_TAGS } from '../../../lib/core/media/svg-syntax.ts';
import { SVG_ALLOWLIST } from './svg-allowlist-table.ts';

export type SvgViolationKind =
  | 'disallowed-element'
  | 'disallowed-attribute'
  | 'event-attribute'
  | 'external-reference'
  | 'disallowed-data-uri'
  | 'processing-instruction'
  | 'declaration'
  | 'unparseable';

export interface SvgViolation {
  readonly kind: SvgViolationKind;
  readonly target: string;
}

export type SvgInspection =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: readonly SvgViolation[] };

// 違反の名前は文書の中で幾らでも変えられるため、判定の記録が大きくなりすぎないよう件数を抑える
export const SVG_MAX_RECORDED_VIOLATIONS = 50;

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';

const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  ...SVG_ALLOWLIST.structureElements,
  ...SVG_ALLOWLIST.shapeAndTextElements,
  ...SVG_ALLOWLIST.paintAndEffectElements,
]);

const ALLOWED_ATTRIBUTES: ReadonlySet<string> = new Set([
  ...SVG_ALLOWLIST.coreAttributes,
  ...SVG_ALLOWLIST.geometryAttributes,
  ...SVG_ALLOWLIST.paintServerAttributes,
  ...SVG_ALLOWLIST.filterAttributes,
  ...SVG_ALLOWLIST.presentationAttributes,
]);

const localNamesOf = (qualifiedNames: readonly string[]): ReadonlySet<string> =>
  new Set(qualifiedNames.map((name) => name.slice(name.indexOf(':') + 1)));

const ALLOWED_XML_ATTRIBUTES = localNamesOf(SVG_ALLOWLIST.xmlAttributes);
const ALLOWED_XLINK_ATTRIBUTES = localNamesOf(SVG_ALLOWLIST.xlinkAttributes);

const EDITOR_NAMESPACES: ReadonlySet<string> = new Set(
  SVG_ALLOWLIST.editorNamespaces.map((namespace) => namespace.uri),
);

const ALLOWED_DATA_URI_PATTERN = new RegExp(
  `^data:image/(?:${SVG_ALLOWLIST.dataUriImageTypes.join('|')});base64,[a-z0-9+/= ]*$`,
  'iu',
);

const XML_DECLARATION_TARGET = 'xml';
const UNPARSEABLE: SvgInspection = Object.freeze({
  ok: false,
  violations: Object.freeze([{ kind: 'unparseable', target: '' } as const]),
});

const DECLARATION_PATTERN = /<!(DOCTYPE|ENTITY|ELEMENT|ATTLIST|NOTATION)/giu;
const EVENT_ATTRIBUTE_PATTERN = /^on/iu;
const XML_REFERENCE_PATTERN =
  /&(?:#[xX]([0-9a-fA-F]+)|#([0-9]+)|(amp|lt|gt|quot|apos));/gu;
const CSS_ESCAPE_PATTERN =
  /\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\r\n|[\n\r\f]|([\s\S]))/gu;
const URL_FUNCTION_PATTERN = /url\(/gu;
const URL_STRIPPED_CHARACTERS = /[\t\n\r]/gu;
// 外部のスタイルシートの読み込み・式の実行・画像の読み込みを、CSSの値の形を問わず検出する
const CSS_EXTERNAL_PATTERNS: readonly RegExp[] = [
  /@import/u,
  /expression\s*\(/u,
  /javascript:/u,
  /image-set\s*\(/u,
  /(?:^|[^a-z0-9_-])src\s*\(/u,
];

const NAMED_XML_REFERENCES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

const MAX_CODE_POINT = 0x10ffff;
const TEXT_KEY = '#text';
const CDATA_KEY = '#cdata';
const ATTRIBUTES_KEY = ':@';
const PROCESSING_INSTRUCTION_PREFIX = '?';

const PARSER = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  allowBooleanAttributes: true,
  processEntities: false,
  htmlEntities: false,
  ignoreDeclaration: false,
  ignorePiTags: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  cdataPropName: CDATA_KEY,
  maxNestedTags: SVG_MAX_NESTED_TAGS,
});

type ElementRealm = 'svg' | 'editor' | 'foreign';

type NamespaceScope = ReadonlyMap<string, string | undefined>;

const ROOT_SCOPE: NamespaceScope = new Map([
  ['xml', XML_NAMESPACE],
  ['xmlns', XMLNS_NAMESPACE],
]);

const UNRESOLVED = Symbol('unresolved');

interface ResolvedName {
  readonly namespace: string | undefined | typeof UNRESOLVED;
  readonly prefixed: boolean;
  readonly localName: string;
}

type Report = (kind: SvgViolationKind, target: string) => void;

const codePointOf = (value: number): string =>
  value <= MAX_CODE_POINT ? String.fromCodePoint(value) : '\uFFFD';

// 実体を展開しない解析の結果は文字参照を残すため、ブラウザが解釈する値へ戻してから検査する
const decodeXmlReferences = (value: string): string =>
  value.replace(
    XML_REFERENCE_PATTERN,
    (_, hex?: string, decimal?: string, named?: string) => {
      if (hex !== undefined) {
        return codePointOf(Number.parseInt(hex, 16));
      }
      if (decimal !== undefined) {
        return codePointOf(Number.parseInt(decimal, 10));
      }
      return NAMED_XML_REFERENCES[named ?? ''] ?? '';
    },
  );

// コメントはトークンをつながないため除かずに検索する(除くと文字列やエスケープの中の`/*`から先が消え、実在の参照を見逃す)
const normalizeCss = (css: string): string =>
  css
    .replace(CSS_ESCAPE_PATTERN, (_, hex?: string, character?: string) =>
      hex === undefined
        ? (character ?? '')
        : codePointOf(Number.parseInt(hex, 16)),
    )
    .toLowerCase();

const URL_EDGE_CODE_UNIT_LIMIT = 0x20;

const isUrlEdgeAt = (value: string, index: number): boolean =>
  value.charCodeAt(index) <= URL_EDGE_CODE_UNIT_LIMIT;

// URLの解析は前後のC0制御文字と空白を除き、途中のタブと改行を無視するため、同じ形にそろえてから先頭を確かめる
const normalizeUrl = (value: string): string => {
  const url = value.replace(URL_STRIPPED_CHARACTERS, '');
  let start = 0;
  let end = url.length;
  while (start < end && isUrlEdgeAt(url, start)) {
    start += 1;
  }
  while (end > start && isUrlEdgeAt(url, end - 1)) {
    end -= 1;
  }
  return url.slice(start, end);
};

const classifyReference = (
  url: string,
  allowsImageDataUri: boolean,
): SvgViolationKind | undefined => {
  if (url.startsWith('#')) {
    return undefined;
  }
  if (/^data:/iu.test(url)) {
    return allowsImageDataUri && ALLOWED_DATA_URI_PATTERN.test(url)
      ? undefined
      : 'disallowed-data-uri';
  }
  return 'external-reference';
};

const urlArgumentOf = (css: string, start: number): string =>
  css
    .slice(start)
    .replace(/^[\s'"]+/u, '')
    .replace(URL_STRIPPED_CHARACTERS, '');

const inspectCss = (value: string): readonly SvgViolationKind[] => {
  const css = normalizeCss(value);
  const compact = css.replace(URL_STRIPPED_CHARACTERS, '');
  const kinds: SvgViolationKind[] = CSS_EXTERNAL_PATTERNS.some((pattern) =>
    pattern.test(compact),
  )
    ? ['external-reference']
    : [];
  for (const match of css.matchAll(URL_FUNCTION_PATTERN)) {
    const kind = classifyReference(
      urlArgumentOf(css, match.index + match[0].length),
      false,
    );
    if (kind !== undefined) {
      kinds.push(kind);
    }
  }
  return kinds;
};

const splitName = (
  qualifiedName: string,
): { readonly prefix: string | undefined; readonly localName: string } => {
  const separator = qualifiedName.indexOf(':');
  return separator === -1
    ? { prefix: undefined, localName: qualifiedName }
    : {
        prefix: qualifiedName.slice(0, separator),
        localName: qualifiedName.slice(separator + 1),
      };
};

const resolveName = (
  qualifiedName: string,
  scope: NamespaceScope,
  defaultNamespace: string | undefined,
): ResolvedName => {
  const { prefix, localName } = splitName(qualifiedName);
  if (prefix === undefined) {
    return { namespace: defaultNamespace, prefixed: false, localName };
  }
  return {
    namespace: scope.has(prefix) ? scope.get(prefix) : UNRESOLVED,
    prefixed: true,
    localName,
  };
};

// 名前空間の無い要素はブラウザでSVGとして描画されないが、描画する実装もあり得るため、SVGの要素と同じ許可リストで検査する
const realmOf = (name: ResolvedName): ElementRealm => {
  if (name.namespace === SVG_NAMESPACE) {
    return 'svg';
  }
  if (name.namespace === undefined && !name.prefixed) {
    return 'svg';
  }
  if (
    typeof name.namespace === 'string' &&
    EDITOR_NAMESPACES.has(name.namespace)
  ) {
    return 'editor';
  }
  return 'foreign';
};

const isNamespaceDeclaration = (name: string): boolean =>
  name === 'xmlns' || name.startsWith('xmlns:');

const scopeOf = (
  attributes: Readonly<Record<string, unknown>>,
  parent: NamespaceScope,
): NamespaceScope => {
  const declarations = Object.entries(attributes).filter(([name]) =>
    isNamespaceDeclaration(name),
  );
  if (declarations.length === 0) {
    return parent;
  }
  const scope = new Map(parent);
  for (const [name, value] of declarations) {
    const uri = decodeXmlReferences(String(value));
    scope.set(
      name === 'xmlns' ? '' : name.slice('xmlns:'.length),
      uri === '' ? undefined : uri,
    );
  }
  return scope;
};

const isAllowedAttribute = (
  name: ResolvedName,
  realm: ElementRealm,
): boolean => {
  if (!name.prefixed) {
    return (
      realm === 'editor' ||
      ALLOWED_ATTRIBUTES.has(name.localName) ||
      SVG_ALLOWLIST.attributeNamePrefixes.some((prefix) =>
        name.localName.startsWith(prefix),
      )
    );
  }
  switch (name.namespace) {
    case XML_NAMESPACE:
      return ALLOWED_XML_ATTRIBUTES.has(name.localName);
    case XLINK_NAMESPACE:
      return ALLOWED_XLINK_ATTRIBUTES.has(name.localName);
    case SVG_NAMESPACE:
      return ALLOWED_ATTRIBUTES.has(name.localName);
    default:
      return realmOf(name) === 'editor';
  }
};

const isReferenceAttribute = (name: ResolvedName): boolean =>
  name.localName === 'href' &&
  (!name.prefixed ||
    name.namespace === XLINK_NAMESPACE ||
    name.namespace === SVG_NAMESPACE);

const inspectAttribute = (
  qualifiedName: string,
  value: string,
  context: {
    readonly scope: NamespaceScope;
    readonly realm: ElementRealm;
    readonly isImage: boolean;
  },
  report: Report,
): void => {
  const name = resolveName(qualifiedName, context.scope, undefined);
  if (EVENT_ATTRIBUTE_PATTERN.test(name.localName)) {
    report('event-attribute', qualifiedName);
    return;
  }
  if (!isAllowedAttribute(name, context.realm)) {
    report('disallowed-attribute', qualifiedName);
  }
  if (isReferenceAttribute(name)) {
    const kind = classifyReference(
      normalizeUrl(decodeXmlReferences(value)),
      context.isImage,
    );
    if (kind !== undefined) {
      report(kind, qualifiedName);
    }
    return;
  }
  for (const kind of inspectCss(decodeXmlReferences(value))) {
    report(kind, qualifiedName);
  }
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const childrenOf = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : [];

const rawTextOf = (children: readonly unknown[]): string =>
  children
    .map((child) =>
      isRecord(child) && TEXT_KEY in child ? String(child[TEXT_KEY]) : '',
    )
    .join('');

// CDATAの中の文字参照はブラウザが戻さないため、CDATAの外の文字だけを戻す
const textOf = (children: readonly unknown[]): string =>
  children
    .filter(isRecord)
    .map((child) => {
      if (CDATA_KEY in child) {
        return rawTextOf(childrenOf(child[CDATA_KEY]));
      }
      return TEXT_KEY in child
        ? decodeXmlReferences(String(child[TEXT_KEY]))
        : '';
    })
    .join('');

const inspectElement = (
  qualifiedName: string,
  node: Readonly<Record<string, unknown>>,
  parentScope: NamespaceScope,
  report: Report,
): void => {
  const attributes = isRecord(node[ATTRIBUTES_KEY]) ? node[ATTRIBUTES_KEY] : {};
  const scope = scopeOf(attributes, parentScope);
  const name = resolveName(qualifiedName, scope, scope.get(''));
  const realm = realmOf(name);
  if (
    realm === 'foreign' ||
    (realm === 'svg' && !ALLOWED_ELEMENTS.has(name.localName))
  ) {
    report('disallowed-element', qualifiedName);
  }
  const context = {
    scope,
    realm,
    isImage: realm === 'svg' && name.localName === 'image',
  };
  for (const [attribute, value] of Object.entries(attributes)) {
    if (!isNamespaceDeclaration(attribute)) {
      inspectAttribute(attribute, String(value), context, report);
    }
  }
  const children = childrenOf(node[qualifiedName]);
  if (realm === 'svg' && name.localName === 'style') {
    for (const kind of inspectCss(textOf(children))) {
      report(kind, qualifiedName);
    }
  }
  inspectNodes(children, scope, report);
};

function inspectNodes(
  nodes: readonly unknown[],
  scope: NamespaceScope,
  report: Report,
): void {
  for (const node of nodes.filter(isRecord)) {
    for (const key of Object.keys(node)) {
      if (key === TEXT_KEY || key === CDATA_KEY || key === ATTRIBUTES_KEY) {
        continue;
      }
      if (key.startsWith(PROCESSING_INSTRUCTION_PREFIX)) {
        const target = key.slice(PROCESSING_INSTRUCTION_PREFIX.length);
        if (target !== XML_DECLARATION_TARGET) {
          report('processing-instruction', target);
        }
        continue;
      }
      inspectElement(key, node, scope, report);
    }
  }
}

const collectViolations = (
  inspect: (report: Report) => void,
): readonly SvgViolation[] => {
  const violations = new Map<string, SvgViolation>();
  inspect((kind, target) => {
    const key = `${kind}\u0000${target}`;
    if (!violations.has(key) && violations.size < SVG_MAX_RECORDED_VIOLATIONS) {
      violations.set(key, Object.freeze({ kind, target }));
    }
  });
  return Object.freeze([...violations.values()]);
};

const resultOf = (violations: readonly SvgViolation[]): SvgInspection =>
  violations.length === 0
    ? Object.freeze({ ok: true })
    : Object.freeze({ ok: false, violations });

const parse = (text: string): readonly unknown[] | undefined => {
  try {
    const nodes: unknown = PARSER.parse(text);
    return Array.isArray(nodes) ? nodes : undefined;
  } catch {
    return undefined;
  }
};

export function inspectSvg(text: string): SvgInspection {
  // 宣言を含む文書は実体の展開の危険を避けるため解析せず、宣言だけを記録する
  const declarations = collectViolations((report) => {
    for (const match of text.matchAll(DECLARATION_PATTERN)) {
      report('declaration', (match[1] ?? '').toUpperCase());
    }
  });
  if (declarations.length > 0) {
    return resultOf(declarations);
  }
  const nodes = parse(text);
  if (nodes === undefined) {
    return UNPARSEABLE;
  }
  return resultOf(
    collectViolations((report) => {
      inspectNodes(nodes, ROOT_SCOPE, report);
    }),
  );
}
