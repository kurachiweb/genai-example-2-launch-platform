import type { Plugin } from 'unified';

import type {
  HastDoctype,
  HastElement,
  HastElementContent,
  HastRoot,
} from '../hast-types.ts';
import { normalizeAnchorFragment } from '../heading-slug.ts';

type HastNode = HastDoctype | HastElementContent;

const ANCHOR_MARKER = '#';

const isElement = (node: HastNode): node is HastElement =>
  node.type === 'element';

// フラグメントが空の#は本文のIDを指さず文書の先頭を指すため、見出しの既定のスラッグへ書き換えない
const prefixedHref = (href: unknown, idPrefix: string): string | undefined =>
  typeof href === 'string' &&
  href.startsWith(ANCHOR_MARKER) &&
  href.length > ANCHOR_MARKER.length
    ? `${ANCHOR_MARKER}${idPrefix}${normalizeAnchorFragment(href.slice(ANCHOR_MARKER.length))}`
    : undefined;

const prefixElement = (element: HastElement, idPrefix: string): HastElement => {
  const children = element.children.map((child) => prefixNode(child, idPrefix));
  const href =
    element.tagName === 'a'
      ? prefixedHref(element.properties['href'], idPrefix)
      : undefined;
  return href === undefined
    ? { ...element, children }
    : { ...element, properties: { ...element.properties, href }, children };
};

const prefixNode = <Node extends HastNode>(
  node: Node,
  idPrefix: string,
): Node => (isElement(node) ? (prefixElement(node, idPrefix) as Node) : node);

export const prefixAnchors = (tree: HastRoot, idPrefix: string): HastRoot => ({
  ...tree,
  children: tree.children.map((child) => prefixNode(child, idPrefix)),
});

export const rehypeAnchorPrefix: Plugin<[string], HastRoot> =
  (idPrefix) => (tree) =>
    prefixAnchors(tree, idPrefix);
