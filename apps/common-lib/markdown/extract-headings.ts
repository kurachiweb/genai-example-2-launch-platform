import { toText } from 'hast-util-to-text';

import type {
  HastDoctype,
  HastElement,
  HastElementContent,
  HastRoot,
} from './hast-types.ts';

type HastNode = HastDoctype | HastElementContent;

type ToTextInput = Parameters<typeof toText>[0];

export type MarkdownHeadingDepth = 2 | 3 | 4 | 5 | 6;

export interface MarkdownHeading {
  readonly depth: MarkdownHeadingDepth;
  readonly id: string;
  readonly text: string;
}

const HEADING_DEPTHS: ReadonlyMap<string, MarkdownHeadingDepth> = new Map([
  ['h2', 2],
  ['h3', 3],
  ['h4', 4],
  ['h5', 5],
  ['h6', 6],
]);

const isElement = (node: HastNode): node is HastElement =>
  node.type === 'element';

const isFootnotesSection = (element: HastElement): boolean => {
  const marker = element.properties['dataFootnotes'];
  return (
    element.tagName === 'section' &&
    marker !== undefined &&
    marker !== null &&
    marker !== false
  );
};

// 構造的な型は読み取り専用の配列を持つため、変更しない関数へ渡すときだけhastの型として扱う
const textOf = (element: HastElement): string =>
  toText(element as unknown as ToTextInput);

const headingsIn = (nodes: readonly HastNode[]): readonly MarkdownHeading[] =>
  nodes.flatMap((node) => {
    if (!isElement(node) || isFootnotesSection(node)) {
      return [];
    }
    const depth = HEADING_DEPTHS.get(node.tagName);
    const id = node.properties['id'];
    if (depth !== undefined && typeof id === 'string') {
      return [{ depth, id, text: textOf(node) }];
    }
    return headingsIn(node.children);
  });

export const extractHeadings = (tree: HastRoot): readonly MarkdownHeading[] =>
  headingsIn(tree.children);
