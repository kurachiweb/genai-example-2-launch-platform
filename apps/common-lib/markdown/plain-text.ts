import { toText } from 'hast-util-to-text';

import type {
  HastDoctype,
  HastElement,
  HastElementContent,
  HastRoot,
} from './hast-types.ts';
import type { SanitizedTree } from './markdown-processor.ts';

type HastNode = HastDoctype | HastElementContent;

type ToTextInput = Parameters<typeof toText>[0];

const FOOTNOTE_LABEL_CLASS = 'sr-only';

const isElement = (node: HastNode): node is HastElement =>
  node.type === 'element';

const hasClass = (element: HastElement, className: string): boolean => {
  const classNames = element.properties['className'];
  return Array.isArray(classNames) && classNames.includes(className);
};

const hasProperty = (element: HastElement, name: string): boolean => {
  const value = element.properties[name];
  return value !== undefined && value !== null && value !== false;
};

// サニタイズの許可リストでは、sr-onlyのh2は脚注の見出しだけが、data-footnote-backrefのaは戻りリンクだけが持てる
const isFootnoteDecoration = (element: HastElement): boolean =>
  (element.tagName === 'h2' && hasClass(element, FOOTNOTE_LABEL_CLASS)) ||
  (element.tagName === 'a' && hasProperty(element, 'dataFootnoteBackref'));

const withoutFootnoteDecorations = <Node extends HastNode>(
  nodes: readonly Node[],
): readonly Node[] =>
  nodes.flatMap((node) => {
    if (!isElement(node)) {
      return [node];
    }
    if (isFootnoteDecoration(node)) {
      return [];
    }
    return [{ ...node, children: withoutFootnoteDecorations(node.children) }];
  });

export const plainTextOf = (tree: SanitizedTree): string => {
  const textTree: HastRoot = {
    ...tree,
    children: withoutFootnoteDecorations(tree.children),
  };
  return toText(textTree as unknown as ToTextInput);
};
