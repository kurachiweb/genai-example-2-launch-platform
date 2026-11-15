import type { Plugin } from 'unified';

import type {
  MdastHeading,
  MdastHtml,
  MdastImage,
  MdastImageReference,
  MdastNode,
  MdastParagraph,
  MdastParent,
  MdastRoot,
  MdastText,
} from '../hast-types.ts';

// Raw HTMLを段落で包まずに置くと、段落の外の文字列として出力されるため、ブロックを子に持つ節点では段落で包む
const FLOW_CONTAINER_TYPES: ReadonlySet<string> = new Set([
  'root',
  'blockquote',
  'listItem',
  'footnoteDefinition',
]);

const H1_MARKER = '# ';

const isHtml = (node: MdastNode): node is MdastHtml => node.type === 'html';

const isImage = (node: MdastNode): node is MdastImage => node.type === 'image';

const isImageReference = (node: MdastNode): node is MdastImageReference =>
  node.type === 'imageReference';

const isHeading = (node: MdastNode): node is MdastHeading =>
  node.type === 'heading';

const isParent = (node: MdastNode): node is MdastParent =>
  node.children !== undefined;

const textOf = (value: string): MdastText => ({ type: 'text', value });

const paragraphOf = (children: readonly MdastNode[]): MdastParagraph => ({
  type: 'paragraph',
  children,
});

const imageSource = (image: MdastImage): string =>
  `![${image.alt ?? ''}](${image.url})`;

const imageReferenceSource = (image: MdastImageReference): string => {
  const alt = `![${image.alt ?? ''}]`;
  switch (image.referenceType) {
    case 'full':
      return `${alt}[${image.label ?? image.identifier}]`;
    case 'collapsed':
      return `${alt}[]`;
    case 'shortcut':
      return alt;
  }
};

const literalizeChildren = (
  children: readonly MdastNode[],
  parentType: string,
): readonly MdastNode[] =>
  children.map((child) => literalizeNode(child, parentType));

const literalizeNode = (node: MdastNode, parentType: string): MdastNode => {
  if (isHtml(node)) {
    const text = textOf(node.value);
    return FLOW_CONTAINER_TYPES.has(parentType) ? paragraphOf([text]) : text;
  }
  if (isImage(node)) {
    return textOf(imageSource(node));
  }
  if (isImageReference(node)) {
    return textOf(imageReferenceSource(node));
  }
  if (isHeading(node) && node.depth === 1) {
    return paragraphOf([
      textOf(H1_MARKER),
      ...literalizeChildren(node.children, 'paragraph'),
    ]);
  }
  if (isParent(node)) {
    return { ...node, children: literalizeChildren(node.children, node.type) };
  }
  return node;
};

export const literalizeSyntax = (tree: MdastRoot): MdastRoot => ({
  ...tree,
  children: literalizeChildren(tree.children, tree.type),
});

export const remarkLiteralSyntax: Plugin<[], MdastRoot> = () =>
  literalizeSyntax;
