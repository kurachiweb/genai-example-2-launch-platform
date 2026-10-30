import type {
  HastDoctype,
  HastElement,
  HastElementContent,
  HastProperties,
  HastRoot,
} from '../hast-types.ts';
import type {
  LinkRelToken,
  MarkdownRenderOptions,
} from '../markdown-options.ts';

type HastNode = HastDoctype | HastElementContent;

type LinkKind = 'unlinked' | 'in-page' | 'same-origin' | 'external';

const ANCHOR_MARKER = '#';

const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set([
  'http:',
  'https:',
  'mailto:',
]);

const MAILTO_PROTOCOL = 'mailto:';

const isElement = (node: HastNode): node is HastElement =>
  node.type === 'element';

const parseUrl = (href: string): URL | undefined => {
  try {
    return new URL(href);
  } catch (error: unknown) {
    if (error instanceof TypeError) {
      return undefined;
    }
    throw error;
  }
};

// 基準のURLを与えずに解釈するため、相対URL・プロトコル相対URLは解釈できずリンクを外す対象になる
const classifyLink = (href: unknown, siteOrigin: string): LinkKind => {
  if (typeof href !== 'string') {
    return 'unlinked';
  }
  if (href.startsWith(ANCHOR_MARKER)) {
    return 'in-page';
  }
  const url = parseUrl(href);
  if (url === undefined || !ALLOWED_PROTOCOLS.has(url.protocol)) {
    return 'unlinked';
  }
  if (url.protocol === MAILTO_PROTOCOL) {
    return 'in-page';
  }
  return url.origin === siteOrigin ? 'same-origin' : 'external';
};

const withRel = (
  properties: HastProperties,
  rel: readonly LinkRelToken[],
): HastProperties => (rel.length === 0 ? properties : { ...properties, rel });

const linkProperties = (
  properties: HastProperties,
  kind: Exclude<LinkKind, 'unlinked'>,
  options: MarkdownRenderOptions,
): HastProperties => {
  switch (kind) {
    case 'in-page':
      return properties;
    case 'same-origin':
      return withRel(properties, options.sameOriginLinkRel ?? []);
    case 'external':
      return withRel(
        { ...properties, target: '_blank' },
        options.externalLinkRel,
      );
  }
};

const applyToElement = (
  element: HastElement,
  options: MarkdownRenderOptions,
): readonly HastElementContent[] => {
  const children = element.children.flatMap((child) =>
    applyToNode(child, options),
  );
  if (element.tagName !== 'a') {
    return [{ ...element, children }];
  }
  const kind = classifyLink(element.properties['href'], options.siteOrigin);
  return kind === 'unlinked'
    ? children
    : [
        {
          ...element,
          properties: linkProperties(element.properties, kind, options),
          children,
        },
      ];
};

const applyToNode = <Node extends HastNode>(
  node: Node,
  options: MarkdownRenderOptions,
): readonly (HastElementContent | Node)[] =>
  isElement(node) ? applyToElement(node, options) : [node];

// サニタイズ済みの木だけを受け取り、許可済みのa要素への属性の追加と、許可外の参照のa要素の除去だけを行う
export const applyLinkPolicy = (
  tree: HastRoot,
  options: MarkdownRenderOptions,
): HastRoot => ({
  ...tree,
  children: tree.children.flatMap((child) => applyToNode(child, options)),
});
