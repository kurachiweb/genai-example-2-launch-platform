import { toText } from 'hast-util-to-text';
import type { Plugin } from 'unified';

import type {
  HastDoctype,
  HastElement,
  HastElementContent,
  HastRoot,
} from '../hast-types.ts';
import { normalizeAnchorFragment, slugifyHeading } from '../heading-slug.ts';

type HastNode = HastDoctype | HastElementContent;

type ToTextInput = Parameters<typeof toText>[0];

type IdAllocator = (slug: string) => string;

const HEADING_TAG_NAMES: ReadonlySet<string> = new Set([
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]);

const isElement = (node: HastNode): node is HastElement =>
  node.type === 'element';

const existingIdOf = (element: HastElement): string | undefined => {
  const id = element.properties['id'];
  return typeof id === 'string' ? id : undefined;
};

const collectExistingIds = (nodes: readonly HastNode[]): Set<string> => {
  const ids = new Set<string>();
  const pending = [...nodes];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (isElement(node)) {
      const id = existingIdOf(node);
      if (id !== undefined) {
        ids.add(normalizeAnchorFragment(id));
      }
      pending.push(...node.children);
    }
  }
  return ids;
};

const numberedId = (slug: string, suffix: number): string =>
  `${slug}-${String(suffix)}`;

// 連番を1から数え直すと同じ見出しが続く入力で処理時間が2乗になるため、スラッグごとに次に試す連番を覚える
const createIdAllocator = (usedIds: Set<string>): IdAllocator => {
  const nextSuffixes = new Map<string, number>();
  return (slug) => {
    if (!usedIds.has(slug)) {
      usedIds.add(slug);
      return slug;
    }
    let suffix = nextSuffixes.get(slug) ?? 1;
    while (usedIds.has(numberedId(slug, suffix))) {
      suffix += 1;
    }
    nextSuffixes.set(slug, suffix + 1);
    const id = numberedId(slug, suffix);
    usedIds.add(id);
    return id;
  };
};

const withId = (element: HastElement, id: string): HastElement => ({
  ...element,
  properties: { ...element.properties, id },
});

// 構造的な型は読み取り専用の配列を持つため、変更しない関数へ渡すときだけhastの型として扱う
const headingText = (heading: HastElement): string =>
  toText(heading as unknown as ToTextInput);

const assignIdsToElement = (
  element: HastElement,
  allocateId: IdAllocator,
): HastElement => {
  const children = element.children.map((child) =>
    assignIdsToNode(child, allocateId),
  );
  const existingId = existingIdOf(element);
  if (existingId !== undefined) {
    return withId(
      { ...element, children },
      normalizeAnchorFragment(existingId),
    );
  }
  if (HEADING_TAG_NAMES.has(element.tagName)) {
    return withId(
      { ...element, children },
      allocateId(slugifyHeading(headingText(element))),
    );
  }
  return { ...element, children };
};

const assignIdsToNode = <Node extends HastNode>(
  node: Node,
  allocateId: IdAllocator,
): Node =>
  isElement(node) ? (assignIdsToElement(node, allocateId) as Node) : node;

// 既にIDを持つ要素(脚注)のIDは#の参照と同じ変換にそろえ、見出しのIDより先に使用済みとして確保する
export const assignHeadingIds = (tree: HastRoot): HastRoot => {
  const allocateId = createIdAllocator(collectExistingIds(tree.children));
  return {
    ...tree,
    children: tree.children.map((child) => assignIdsToNode(child, allocateId)),
  };
};

export const rehypeHeadingIds: Plugin<[], HastRoot> = () => assignHeadingIds;
