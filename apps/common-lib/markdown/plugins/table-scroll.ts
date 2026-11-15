import type {
  HastDoctype,
  HastElement,
  HastElementContent,
  HastProperties,
  HastRoot,
} from '../hast-types.ts';

type HastNode = HastDoctype | HastElementContent;

const SCROLL_REGION_PROPERTIES: HastProperties = {
  className: ['markdown-table-scroll'],
  tabIndex: 0,
  role: 'region',
  ariaLabel: '表(横にスクロールできます)',
};

const isElement = (node: HastNode): node is HastElement =>
  node.type === 'element';

const wrapElement = (element: HastElement): HastElement => {
  const wrapped: HastElement = {
    ...element,
    children: element.children.map((child) => wrapNode(child)),
  };
  return element.tagName === 'table'
    ? {
        type: 'element',
        tagName: 'div',
        properties: SCROLL_REGION_PROPERTIES,
        children: [wrapped],
      }
    : wrapped;
};

const wrapNode = <Node extends HastNode>(node: Node): Node =>
  isElement(node) ? (wrapElement(node) as Node) : node;

// 表の枠は横スクロールの領域にキーボードのフォーカスで移動できるようにするため、名前付きの領域にする
export const wrapTables = (tree: HastRoot): HastRoot => ({
  ...tree,
  children: tree.children.map((child) => wrapNode(child)),
});
