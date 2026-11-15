import { editorStateOptionsCtx } from '@milkdown/kit/core';
import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx';
import {
  headingSchema,
  imageSchema,
  paragraphSchema,
} from '@milkdown/kit/preset/commonmark';
import type { Node as ProseNode, NodeType } from '@milkdown/kit/prose/model';
import {
  EditorState,
  Plugin,
  PluginKey,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

interface ForbiddenNodeTypes {
  readonly heading: NodeType;
  readonly image: NodeType;
  readonly paragraph: NodeType;
}

interface ForbiddenNode {
  readonly node: ProseNode;
  readonly position: number;
}

const H1_MARKER = '# ';

const typesOf = (ctx: Ctx): ForbiddenNodeTypes => ({
  heading: headingSchema.type(ctx),
  image: imageSchema.type(ctx),
  paragraph: paragraphSchema.type(ctx),
});

const isForbidden = (node: ProseNode, types: ForbiddenNodeTypes): boolean =>
  node.type === types.image ||
  (node.type === types.heading && node.attrs.level === 1);

const imageSourceOf = (image: ProseNode): string => {
  const alt: unknown = image.attrs.alt;
  const src: unknown = image.attrs.src;
  return `![${typeof alt === 'string' ? alt : ''}](${typeof src === 'string' ? src : ''})`;
};

const forbiddenNodesOf = (
  doc: ProseNode,
  types: ForbiddenNodeTypes,
): readonly ForbiddenNode[] => {
  const found: ForbiddenNode[] = [];
  doc.descendants((node, position) => {
    if (isForbidden(node, types)) {
      found.push({ node, position });
    }
  });
  return found;
};

// 表示部品の描画と同じく、見出しレベル1は先頭に「# 」を付けた段落へ、画像は「![代替テキスト](URL)」の文字列へ置き換える。
// 後ろの節点から置き換えるため、前の節点の位置は置き換えの影響を受けない
const literalizeForbiddenNodes = (
  state: EditorState,
  types: ForbiddenNodeTypes,
): Transaction | undefined => {
  const forbidden = forbiddenNodesOf(state.doc, types);
  if (forbidden.length === 0) {
    return undefined;
  }
  const { tr, schema } = state;
  for (const { node, position } of forbidden.toReversed()) {
    if (node.type === types.image) {
      tr.replaceWith(
        position,
        position + node.nodeSize,
        schema.text(imageSourceOf(node), node.marks),
      );
    } else {
      tr.setNodeMarkup(position, types.paragraph).insert(
        position + 1,
        schema.text(H1_MARKER),
      );
    }
  }
  return tr;
};

// 入力・貼り付け・外部からの値の置き換えで変わった文書を、同じ取り消しの単位のまま置き換える
export const forbiddenNodeNormalizer: MilkdownPlugin = $prose((ctx) => {
  const types = typesOf(ctx);
  return new Plugin({
    key: new PluginKey('MARKDOWN_EDITOR_FORBIDDEN_NODES'),
    appendTransaction: (transactions, _, state) =>
      transactions.some((transaction) => transaction.docChanged)
        ? (literalizeForbiddenNodes(state, types) ?? null)
        : null,
  });
});

// 既存の値の読み込みは取引を経ずに文書を作るため、編集領域の最初の状態を作る前に置き換える
export const configureInitialDocument = (ctx: Ctx): void => {
  ctx.update(editorStateOptionsCtx, (override) => (options) => {
    const resolved = override(options);
    if (resolved.doc === undefined) {
      return resolved;
    }
    const transaction = literalizeForbiddenNodes(
      EditorState.create({ doc: resolved.doc }),
      typesOf(ctx),
    );
    return transaction === undefined
      ? resolved
      : { ...resolved, doc: transaction.doc };
  });
};
