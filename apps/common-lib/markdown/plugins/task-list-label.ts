import { trimWhiteSpace } from '../../text/white-space.ts';
import type {
  HastDoctype,
  HastElement,
  HastElementContent,
  HastRoot,
} from '../hast-types.ts';

type HastNode = HastDoctype | HastElementContent;

const TASK_ITEM_CLASS = 'task-list-item';

const DEFAULT_TASK_LABEL = 'タスク';

const NESTED_LIST_TAGS: ReadonlySet<string> = new Set(['ul', 'ol']);

const WHITE_SPACE_RUN = /\p{White_Space}+/gu;

const isElement = (node: HastNode): node is HastElement =>
  node.type === 'element';

const isTaskItem = (element: HastElement): boolean => {
  const classNames = element.properties['className'];
  return (
    element.tagName === 'li' &&
    Array.isArray(classNames) &&
    classNames.includes(TASK_ITEM_CLASS)
  );
};

const isCheckbox = (node: HastNode): node is HastElement =>
  isElement(node) &&
  node.tagName === 'input' &&
  node.properties['type'] === 'checkbox';

const textOf = (nodes: readonly HastElementContent[]): string =>
  nodes
    .map((node) => {
      if (node.type === 'text') {
        return node.value;
      }
      if (!isElement(node) || NESTED_LIST_TAGS.has(node.tagName)) {
        return '';
      }
      return node.tagName === 'br' ? ' ' : textOf(node.children);
    })
    .join('');

const labelOf = (item: HastElement): string =>
  trimWhiteSpace(textOf(item.children).replaceAll(WHITE_SPACE_RUN, ' ')) ||
  DEFAULT_TASK_LABEL;

const withLabel = <Node extends HastElementContent>(
  node: Node,
  label: string,
): Node =>
  isCheckbox(node)
    ? { ...node, properties: { ...node.properties, ariaLabel: label } }
    : node;

// 緩いリストの項目はチェックボックスを段落の中に置くため、項目の直下と直下の段落の中のチェックボックスに名前を付ける
const labelItem = (item: HastElement): HastElement => {
  const label = labelOf(item);
  return {
    ...item,
    children: item.children.map((child) =>
      isElement(child) && child.tagName === 'p'
        ? {
            ...child,
            children: child.children.map((grandchild) =>
              withLabel(grandchild, label),
            ),
          }
        : withLabel(child, label),
    ),
  };
};

const labelElement = (element: HastElement): HastElement => {
  const labeled = isTaskItem(element) ? labelItem(element) : element;
  return {
    ...labeled,
    children: labeled.children.map((child) => labelNode(child)),
  };
};

const labelNode = <Node extends HastNode>(node: Node): Node =>
  isElement(node) ? (labelElement(node) as Node) : node;

// タスクリストのチェックボックスは表示だけのもので、名前が無いと支援技術が何のチェックボックスかを伝えられないため、項目の文字列を名前にする
export const labelTaskCheckboxes = (tree: HastRoot): HastRoot => ({
  ...tree,
  children: tree.children.map((child) => labelNode(child)),
});
